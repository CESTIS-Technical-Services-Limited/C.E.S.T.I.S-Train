/* "Total Enrolled Students" kept climbing after every sync.

   The Centre saw the figure go 224, then 228, then 242, and it only came back
   to the true number when somebody opened Student Progress or pressed Sync —
   then drifted up again on its own.

   Why. A background sync merges another device's copy of the backup and pushes
   in any trainee this device does not already hold. Two devices holding the same
   person under slightly different spellings — "Electrical Installation" against
   "02. Electrical Installation", or a name typed with a double space — each
   therefore gained a SECOND copy of that person, and the roll grew by a few
   records every time the sync ran.

   The roll does have a settle pass that collapses exactly these, but it was only
   ever run by the manual "Sync from Cloud" button, by the login sync, and by the
   pre-login sync. The merge that the automatic background sync uses ran without
   it. Student Progress has its own dedupe and tells the dashboard when it is
   done, which is why visiting that page appeared to "fix" the number.

   Reproduced in a browser against the code as it was: a roll of three real
   people became six after a single background merge, each person listed twice.
   After the fix the same three merges leave it at three.

   Pinned here, for both builds:
     - the merge settles the roll itself, so every sync path collapses it;
     - and refreshes the figures on screen, because the Dashboard count and the
       pipeline were only ever refreshed from the student-list page;
     - the paths that already settled still do;
     - and the shared dedupe really does collapse the two shapes the Centre hit.

   Run: node tests/roster-settles-on-sync.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const ROOT = path.join(__dirname, '..');
const BUILDS = ['index.html', 'Offline System/index.html'];

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

/* ---------- 1. The merge settles the roll ---------- */
console.log('Every sync path collapses the roll, not just the Sync button');

BUILDS.forEach(where => {
  const src = fs.readFileSync(path.join(ROOT, where), 'utf8');
  const merge = extractFunction(src, 'mergeBackupData', where);

  assert(/cestisSettleRoster\('a background sync'\)/.test(merge),
    where + ': mergeBackupData settles the roll itself — this is the merge the automatic sync uses');
  assert(/students\.push\(cloudStudent\)/.test(merge),
    where + ': (and it is still the merge that adds trainees, so the settle belongs here)');

  // The settle must come AFTER the students have been merged in, or it collapses
  // nothing.
  assert(merge.indexOf('students.push(cloudStudent)') < merge.indexOf("cestisSettleRoster('a background sync')"),
    where + ': the settle runs after the incoming trainees have been added');

  // ...and the figures on screen are refreshed.
  assert(/refreshDashboardStudentTotals/.test(merge),
    where + ': the Dashboard total is refreshed after a merge — it used to update only from the student-list page');
  assert(/updatePipelineCounts/.test(merge),
    where + ': and so is the Student Progress Pipeline, which showed the same inflated roll');
  assert(/refreshStudentDependentViews/.test(merge),
    where + ': the roll-dependent views are rebuilt when records were actually merged away');

  // The heavier rebuild must not run on every quiet tick.
  assert(/if \(_settled > 0\) \{[\s\S]{0,160}refreshStudentDependentViews/.test(merge),
    where + ': that heavier rebuild runs only when something was actually collapsed');

  // The paths that already settled still do.
  ['Sync from Cloud', 'the login sync', 'the pre-login sync'].forEach(reason => {
    assert(src.indexOf("cestisSettleRoster('" + reason + "')") !== -1,
      where + ': the ' + reason + ' path still settles the roll');
  });
});

/* ---------- 2. The dedupe collapses the shapes the Centre hit ---------- */
console.log('The shared dedupe collapses the exact duplicates a sync produced');

const roll = [
  { id: 'STU-1', name: 'Crystal-Lee Gordon', course: 'Electrical Installation', stage: 'nyc', progress: 10, lastModified: '2026-09-01T09:00:00.000Z' },
  { id: 'STU-2', name: 'Kevin Allen', course: 'Photovoltaic Installer', stage: 'nyc', progress: 10, lastModified: '2026-09-01T09:00:00.000Z' },
  // The same two people as another device wrote them.
  { id: 'STU-A', name: 'Crystal-Lee Gordon', course: '02. Electrical Installation', stage: 'nyc', progress: 10, lastModified: '2026-09-02T09:00:00.000Z' },
  { id: 'STU-B', name: 'Kevin  Allen', course: 'Photovoltaic Installer', stage: 'nyc', progress: 10, lastModified: '2026-09-02T09:00:00.000Z' }
];
const res = Core.dedupeStudents(roll.map(s => Object.assign({}, s)));

assert(res.students.length === 2,
  'four records for two people collapse to two (got ' + res.students.length + ')');
assert(res.removed === 2, 'and the pass reports the two it removed');
assert(res.students.filter(s => /Gordon/.test(s.name)).length === 1,
  'the two spellings of one programme are one person, not two');
assert(res.students.filter(s => /Kevin/.test(s.name)).length === 1,
  'and a name typed with a double space is the same person');
assert(res.idMap && Object.keys(res.idMap).length > 0,
  'the pass reports how ids were folded, so attendance and results follow the survivor');

// Running it again changes nothing — this is what makes it safe on every merge.
const again = Core.dedupeStudents(res.students.map(s => Object.assign({}, s)));
assert(again.removed === 0 && again.students.length === 2,
  'settling an already-settled roll removes nothing, so running it on every sync costs nothing');

/* ---------- 3. Genuinely different people are NOT collapsed ---------- */
console.log('Two different people are still two people');

const twoPeople = Core.dedupeStudents([
  { id: 'STU-1', name: 'Kevin Allen', course: 'Photovoltaic Installer', stage: 'nyc' },
  { id: 'STU-2', name: 'Kevin Brown', course: 'Photovoltaic Installer', stage: 'nyc' }
]);
assert(twoPeople.students.length === 2, 'two different names stay two records');

const sameNameDifferentProgramme = Core.dedupeStudents([
  { id: 'STU-1', name: 'Jodene Barrett', course: 'Welding & Fabrication', stage: 'nyc' },
  { id: 'STU-2', name: 'Jodene Barrett', course: 'Photovoltaic Installer', stage: 'nyc' }
]);
assert(sameNameDifferentProgramme.students.length === 2,
  'one person enrolled on two different programmes keeps a record for each');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
