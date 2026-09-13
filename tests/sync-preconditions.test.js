/* Three ways one device quietly undid another device's work.

   1. A REGISTRATION COULD ERASE THE AFTERNOON. When a trainee registers, the
      page downloads the WHOLE shared backup, adds one account, and writes the
      whole thing back — then stamps that same content over every other folder
      copy. There was no version check of any kind. Anything another device saved
      between the read and the write was reverted: an instructor entering the
      week's results a few seconds earlier lost them, from the main file and from
      all the redundant copies at once, with no error. Their own device had
      already marked the work as saved, so it did not re-upload.

   2. A PAST ATTENDANCE REGISTER GOT CONTAMINATED. attendanceRecords holds ONE
      quarter — whichever the user last opened — and the save mirrors that array
      straight back into that quarter's bucket. The merge matched on trainee and
      date only, with no quarter test. So opening an old register to check
      something and letting a single sync tick run appended another device's
      CURRENT rows into the old quarter and saved them there, permanently.

   3. CERTIFICATE TEMPLATE WORK WAS OVERWRITTEN BY AN OLDER COPY. The template
      merge replaced the local copy with the cloud's outright, with no comparison
      at all, then saved. An administrator who had just repositioned the fields
      on a certificate lost that work the moment anybody signed in. Every other
      collection in the same function merges newest-wins; this one did not — and
      templates were not even stamped, so there was nothing to compare.

   Run: node tests/sync-preconditions.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const BUILDS = ['index.html', 'Offline System/index.html'];
const Core = require('../cestis-core.js');

function extractFunction(src, name, where) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(where + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

/* ---------- 1. The registration push checks before it writes ---------- */
console.log('A registration cannot revert what another device just saved');

BUILDS.forEach(where => {
  const src = read(where);
  const fn = extractFunction(src, 'studentPushRegistration', where);

  assert(/fields=version/.test(fn),
    where + ': the registration push reads the file version');
  assert(/_regBaseVersion/.test(fn),
    where + ': and remembers which version it based its copy on');
  assert(/_nowVersion && _regBaseVersion && _nowVersion !== _regBaseVersion/.test(fn),
    where + ': it compares again immediately before writing');
  assert(/_regAttempts/.test(fn) && /while \(_regAttempts < 4\)/.test(fn),
    where + ': and starts again from the newer content rather than overwriting it');
  assert(/_regReadBackup\(\)/.test(fn),
    where + ': re-reading through one helper, so the retry sees the same shape as the first read');
  // The one account is re-applied to the NEW content, not the stale copy.
  assert(/accountList\.push\(newUserAccount\);[\s\S]{0,400}continue;/.test(fn),
    where + ': the account being registered is re-applied to the re-read copy before the retry');
});

/* ---------- 2. Attendance stays in its own quarter ---------- */
console.log('A sync cannot put this quarter\'s attendance into a past register');

BUILDS.forEach(where => {
  const src = read(where);
  assert(/CESTISCore\.recordInQuarter\(cloudRec, _attQ\.fy, _attQ\.q\)/.test(src),
    where + ': incoming attendance is tested against the quarter that is loaded');
  assert(/var _attQ = \(typeof attnLoadedQuarter !== 'undefined' && attnLoadedQuarter\)/.test(src),
    where + ': against the LOADED quarter, which is the one the save writes back to');
});

// The helper itself does the right thing.
assert(Core.recordInQuarter({ studentId: 'S1', date: '2026-04-15' }, '2026/2027', 1) === true,
  'a record dated inside the quarter belongs to it');
assert(Core.recordInQuarter({ studentId: 'S1', date: '2026-11-15' }, '2026/2027', 1) === false,
  'a record from another quarter does not — this is the test that was missing');
assert(Core.recordInQuarter({ fy: '2026/2027', quarter: 3 }, '2026/2027', 1) === false,
  'and a record carrying its own quarter is judged by that');

/* ---------- 3. The newer certificate template wins ---------- */
console.log('Certificate template work is not overwritten by an older copy');

BUILDS.forEach(where => {
  const src = read(where);
  assert(/if \(_ct < _lt\) return;   \/\/ this device holds the newer template — keep it/.test(src),
    where + ': the merge keeps the local template when it is the newer one');
  assert(/updatedAt: new Date\(\)\.toISOString\(\),/.test(src),
    where + ': and saving a template stamps it, so there is something to compare');

  /* Run the merge rule both ways. */
  const sb = { out: null };
  vm.createContext(sb);
  vm.runInContext(`
    function mergeTpl(localT, cloudT){
      Object.keys(cloudT).forEach(function(key){
        if(!localT[key]){ localT[key]=cloudT[key]; return; }
        var _lt=Date.parse((localT[key].updatedAt||localT[key].savedAt)||'')||0;
        var _ct=Date.parse((cloudT[key].updatedAt||cloudT[key].savedAt)||'')||0;
        if(_ct < _lt) return;
        var b1=localT[key].bgPage1, b2=localT[key].bgPage2;
        localT[key]=cloudT[key];
        if(b1) localT[key].bgPage1=b1;
        if(b2) localT[key].bgPage2=b2;
      });
      return localT;
    }`, sb);

  const NEWER = '2026-09-12T10:00:00.000Z', OLDER = '2026-09-11T10:00:00.000Z';
  sb.a = { A: { updatedAt: NEWER, note: 'edited here', bgPage1: 'IMG' } };
  sb.b = { A: { updatedAt: OLDER, note: 'older cloud copy' } };
  assert(vm.runInContext('mergeTpl(a, b).A.note', sb) === 'edited here',
    where + ': an older cloud copy does not overwrite work just done here');
  assert(vm.runInContext('mergeTpl(a, b).A.bgPage1', sb) === 'IMG',
    where + ': and the background images are kept either way');

  sb.c = { A: { updatedAt: OLDER, note: 'stale here' } };
  sb.d = { A: { updatedAt: NEWER, note: 'newer from another device' } };
  assert(vm.runInContext('mergeTpl(c, d).A.note', sb) === 'newer from another device',
    where + ': but a genuinely newer template from another device is still adopted');

  sb.e = {};
  sb.f = { A: { note: 'first time this device has seen it' } };
  assert(vm.runInContext('mergeTpl(e, f).A.note', sb) === 'first time this device has seen it',
    where + ': and a template this device has never seen is taken as before');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
