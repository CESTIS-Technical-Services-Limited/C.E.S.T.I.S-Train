/* The two builds must not drift apart, because a fix made in one never reaches
   the Centre running the other.

   What had happened: "Offline System" was a current page layer sitting on an old
   core. The dashboard page had been refreshed, so it carried the newest work,
   but the shared libraries underneath it had not. The offline build was
   therefore missing, among other things:

     - the guard that makes a collection unloseable (an empty value never
       replaces stored records) — and offline that is worse than online, because
       there is no Drive revision history to recover from;
     - the trainee-identity rework, so the same person written two ways stayed
       two records, listed twice and counted twice;
     - the write counter every idle-tick gate depends on, so five separate
       "has anything changed?" checks were permanently open and every tick did
       the full expensive work on every device;
     - the board portal's data and its virement rulings;
     - any pull after the page first opened, so a fee recorded on the office
       desktop stayed invisible on the Coordinator's laptop until somebody
       reloaded, and each push merged against a copy that had been stale all day.

   And one fix went the other way: the offline build knew not to treat a pull's
   own writes as user edits, while the main build did not — so the value it had
   just downloaded was stamped "now" and pushed straight back, and two devices
   could trade the same value between them indefinitely.

   Run: node tests/build-parity.test.js */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ---------- 1. The shared libraries are one copy, not two ---------- */
console.log('Both builds run the same shared libraries');

[
  'cestis-core.js',
  'cmc-portal.js',
  'staff-appraisals.js',
  'finance-docs.js',
  'finance-logos.js',
  'cert-template-seed.js',
  'transcript-assets.js'
].forEach(lib => {
  assert(read(lib) === read('Offline System/' + lib),
    lib + ' is identical in both builds — a fix in one now reaches the other');
});

/* cestis-page-cloud.js is deliberately NOT identical: the offline copy talks to
   the Centre's own server and mirrors the whole store. What must match is the
   behaviour that protects data. */
console.log('The two page-cloud copies differ only where they must');

const rootPC = read('cestis-page-cloud.js');
const offPC = read('Offline System/cestis-page-cloud.js');

assert(/_applying/.test(rootPC) && /_applying/.test(offPC),
  'both know that a pull writing the cloud\'s copy back is not an edit made here');
assert(/if \(API\._applying\) return r;/.test(rootPC),
  'the main build no longer re-uploads the value it just downloaded — two devices used to trade it for ever');
assert(/API\._applying = true;/.test(rootPC) && /API\._applying = false;/.test(rootPC),
  'and sets the flag around the merge, not just declares it');
assert(/_refreshWired/.test(rootPC) && /_refreshWired/.test(offPC),
  'both keep pulling after the page opens, rather than once at start-up');
assert(/LOCAL_BASE/.test(offPC) && !/LOCAL_BASE/.test(rootPC),
  'the offline copy alone talks to the Centre\'s own server (this difference is deliberate)');

/* ---------- 2. The guards the offline build was missing ---------- */
console.log('Every page that owns records guards its writes, in both builds');

[
  ['Student-Progress.html', 'spSaveCollection', 'voctrain_students'],
  ['Offline System/Student-Progress.html', 'spSaveCollection', 'voctrain_students'],
  ['School.Fee.html', 'feePersist', 'cestiSchoolFeeStudents'],
  ['Offline System/School.Fee.html', 'feePersist', 'cestiSchoolFeeStudents']
].forEach(([where, writer, key]) => {
  const src = read(where);
  assert(src.indexOf('function ' + writer + '(') !== -1,
    where + ': defines its guarded writer ' + writer + '()');
  assert(/guardedSet/.test(src),
    where + ': which goes through the rule that an empty value never replaces records');
  assert(src.indexOf("CESTISStore.setItem('" + key + "', JSON.stringify(") === -1,
    where + ': and ' + key + ' is no longer written raw, around the guard');
});

/* ---------- 3. The core carries what the offline build lacked ---------- */
console.log('The shared core carries the protections and the identity rework');

const core = read('Offline System/cestis-core.js');
[
  ['guardedSet', 'the write guard'],
  ['wouldDiscardRecords', 'the rule behind it'],
  ['isEmptyValue', 'and the emptiness test'],
  ['twinIndex', 'the trainee-identity index'],
  ['collapseSameNameStudents', 'the same-name collapse'],
  ['recordInQuarter', 'the quarter test the attendance merge needs'],
  ['writes: 0', 'the write counter every idle-tick gate depends on']
].forEach(([needle, what]) => {
  assert(core.indexOf(needle) !== -1, 'the offline core carries ' + what);
});

/* ---------- 4. Neither build is missing a page the other links to ---------- */
console.log('Neither build links to a page it does not have');

function walkHtml(dir, acc) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, f);
    const st = fs.statSync(path.join(ROOT, rel));
    if (st.isDirectory()) { if (!/node_modules|vendor|\.git/.test(f)) walkHtml(rel, acc); }
    else if (f.endsWith('.html')) acc.push(rel);
  }
  return acc;
}
const offlinePages = walkHtml('Offline System', []);
const rootOnly = ['Income.Expenditure.html', 'income-expenditure-core.js',
                  'MegaData-Admin.html', 'MegaData-Adjudication.html'];
rootOnly.forEach(missing => {
  const referrers = offlinePages.filter(pg => read(pg).indexOf(missing) !== -1);
  assert(referrers.length === 0,
    'no offline page links to ' + missing + ', which that build does not ship (would be a dead link)');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
