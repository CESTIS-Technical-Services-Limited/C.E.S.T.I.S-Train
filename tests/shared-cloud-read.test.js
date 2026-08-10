/* Some collections belong to one page but are READ by several: the trainee
   roll, the training centres and their tombstones, the fee roll.

   Each page backs up only the keys it OWNS, so a page that merely reads a
   shared collection never fetched it from Google Drive at all — it rendered
   whatever happened to be in that device's local storage. On a machine that had
   not opened the owning page that meant stale data, or none, and the page then
   wrote its own view back over everybody else's.

   CESTISCore.pageCloud now says where each shared collection actually lives, so
   any page can pull the current copy when it syncs. These tests pin the two
   things that make that safe:

     - a reader pulls the shared keys it asked for, and nothing else out of
       somebody else's file;
     - a reader NEVER pushes a key it does not own, so reading the trainee roll
       can never overwrite the page that owns it.

   Run: node tests/shared-cloud-read.test.js */
'use strict';

const Core = require('../cestis-core.js');
const PC = Core.pageCloud;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* The two specs that matter most: they read each other's data. */
const FEE_SPEC = {
  page: 'School Fee Management',
  file: 'CESTIS_School_Fees.json',
  keys: ['cestiFeeStructure'],
  prefixes: ['cestiSchoolFee'],
  reads: ['voctrain_skillAreas', 'voctrain_deletedCentreIds', 'voctrain_students',
          'voctrain_deletedStudentIds']
};
const SP_SPEC = {
  page: 'Student Progress',
  file: 'CESTIS_Student_Progress.json',
  keys: ['voctrain_students', 'voctrain_attendance', 'voctrain_examResults',
         'voctrain_certDownloadApprovals', 'voctrain_deletedStudentIds',
         'voctrain_deletedCentreIds', 'voctrain_instructorData', 'voctrain_skillAreas',
         'voctrain_studentProfiles'],
  reads: ['cestiSchoolFeeStudents', 'cestiSchoolFeeDeletedLmsIds']
};

/* ---------- 1. Where does each shared collection live? ---------- */
console.log('Every shared collection names the file that carries it');

assertEq(PC.sourceOf('voctrain_skillAreas').file, 'CESTIS_Student_Progress.json',
  'the training centres travel with Student Progress');
assertEq(PC.sourceOf('voctrain_deletedCentreIds').file, 'CESTIS_Student_Progress.json',
  'and so do their tombstones — restoring the centres without the record of ' +
  'what was deleted brings every deleted centre back');
assertEq(PC.sourceOf('cestiSchoolFeeStudents').file, 'CESTIS_School_Fees.json',
  'the fee roll travels with School Fee');
assertEq(PC.sourceOf('voctrain_certTranscriptRequests').file, 'CESTIS_Transcript_Requests.json',
  'and transcript requests with their own page');
assertEq(PC.sourceOf('some_page_local_thing'), null, 'a page-local key belongs to nobody');
assertEq(PC.isShared('voctrain_students'), true, 'the trainee roll is shared');
assertEq(PC.isShared('cestis_pagecloud_stamps__x'), false, 'bookkeeping is not');

console.log('No collection is claimed by two files at once');
const seen = {};
let doubled = 0;
PC.sharedSources().forEach(src => src.keys.forEach(k => {
  if (seen[k]) doubled++;
  seen[k] = src.file;
}));
assertEq(doubled, 0, 'one owner each, or two pages would fight over the same key');

/* ---------- 2. What must a page fetch? ---------- */
console.log('A page is told exactly which other files it has to pull');

let plan = PC.sharedPullPlan(FEE_SPEC.reads, FEE_SPEC.file);
assertEq(plan.length, 1, 'School Fee needs one other file');
assertEq(plan[0].file, 'CESTIS_Student_Progress.json', 'the one carrying the centres and the roll');
assertEq(plan[0].keys.sort().join(','),
  'voctrain_deletedCentreIds,voctrain_deletedStudentIds,voctrain_skillAreas,voctrain_students',
  'and exactly the four keys it reads');

plan = PC.sharedPullPlan(SP_SPEC.reads, SP_SPEC.file);
assertEq(plan.length, 1, 'Student Progress needs one other file');
assertEq(plan[0].file, 'CESTIS_School_Fees.json', 'the one carrying the fee roll');

console.log('A page is never told to pull its own file twice');
plan = PC.sharedPullPlan(['voctrain_students', 'voctrain_skillAreas'], 'CESTIS_Student_Progress.json');
assertEq(plan.length, 0, 'it already pulls that file the ordinary way');

console.log('Keys nobody owns are simply not fetched');
plan = PC.sharedPullPlan(['whatever_local_key', 'voctrain_students'], 'CESTIS_School_Fees.json');
assertEq(plan.length, 1, 'only the one with an owner');
assertEq(plan[0].keys.join(','), 'voctrain_students', 'and only that key');

console.log('Reading nothing asks for nothing');
assertEq(PC.sharedPullPlan([], 'CESTIS_School_Fees.json').length, 0, 'an empty list');
assertEq(PC.sharedPullPlan(null, 'CESTIS_School_Fees.json').length, 0, 'and no list at all');

/* ---------- 3. A reader takes only what it asked for ---------- */
console.log("A reader takes its keys out of the owner's file and leaves the rest");

const OWNER_FILE = {
  voctrain_students: '[{"id":"S1"}]',
  voctrain_skillAreas: '[{"id":1,"name":"Plumbing"}]',
  voctrain_attendance: '[{"id":"A1"}]',        // the owner's business, not the reader's
  voctrain_studentProfiles: '{"S1":{}}'        // likewise
};
const picked = PC.pickShared(OWNER_FILE, ['voctrain_students', 'voctrain_skillAreas']);
assertEq(Object.keys(picked).sort().join(','), 'voctrain_skillAreas,voctrain_students',
  'just the two it reads');
assert(!('voctrain_attendance' in picked),
  "the attendance register stays the owning page's business");
assertEq(Object.keys(PC.pickShared(OWNER_FILE, ['nothing_here'])).length, 0,
  'a key the file does not carry yields nothing, not undefined');
assertEq(Object.keys(PC.pickShared(null, ['voctrain_students'])).length, 0,
  'and an empty file is not a crash');

/* ---------- 4. The merge: fresher cloud data is adopted ---------- */
console.log('A device that has never synced adopts the Centre\'s shared data');

// The fee page on a fresh machine: no centres of its own, none stamped.
let res = PC.mergeKeys(
  { voctrain_skillAreas: '[]' }, {},
  { voctrain_skillAreas: '[{"id":1,"name":"Plumbing"}]' },
  { voctrain_skillAreas: '2026-08-01T10:00:00.000Z' },
  { firstSync: true });
assertEq(res.data.voctrain_skillAreas, '[{"id":1,"name":"Plumbing"}]',
  "the Centre's centres win over an empty local list on a first sync");
assertEq(res.changed.join(','), 'voctrain_skillAreas', 'and the key is reported as changed');

console.log('Afterwards, the newer of the two wins');
res = PC.mergeKeys(
  { voctrain_skillAreas: '[{"id":1,"name":"Plumbing"}]' },
  { voctrain_skillAreas: '2026-08-01T10:00:00.000Z' },
  { voctrain_skillAreas: '[{"id":1,"name":"Plumbing"},{"id":2,"name":"Welding"}]' },
  { voctrain_skillAreas: '2026-08-02T10:00:00.000Z' });
assert(res.data.voctrain_skillAreas.indexOf('Welding') !== -1,
  'a centre added on another device arrives here');

res = PC.mergeKeys(
  { voctrain_skillAreas: '[{"id":1,"name":"Plumbing"}]' },
  { voctrain_skillAreas: '2026-08-03T10:00:00.000Z' },
  { voctrain_skillAreas: '[{"id":1,"name":"Plumbing"},{"id":2,"name":"Welding"}]' },
  { voctrain_skillAreas: '2026-08-02T10:00:00.000Z' });
assertEq(res.data.voctrain_skillAreas, '[{"id":1,"name":"Plumbing"}]',
  'but an older cloud copy never undoes a newer local edit');
assertEq(res.changed.length, 0, 'and nothing is reported as changed');

console.log('A deletion recorded on another device travels with the centres');
res = PC.mergeKeys(
  { voctrain_deletedCentreIds: '[]' }, {},
  { voctrain_deletedCentreIds: '["3"]' },
  { voctrain_deletedCentreIds: '2026-08-02T10:00:00.000Z' },
  { firstSync: true });
assertEq(res.data.voctrain_deletedCentreIds, '["3"]',
  'so a centre deleted elsewhere stays deleted here, rather than reappearing');

/* ---------- 5. The guarantee: a reader cannot overwrite the owner ---------- */
console.log('A page never uploads a collection it only reads');

FEE_SPEC.reads.forEach(k => {
  assertEq(PC.ownsKey(FEE_SPEC, k), false,
    'School Fee does not own ' + k + ', so it is never included in what that page pushes');
});
SP_SPEC.reads.forEach(k => {
  assertEq(PC.ownsKey(SP_SPEC, k), false, 'Student Progress does not own ' + k);
});

console.log('What a page DOES own is unchanged by any of this');
assertEq(PC.ownsKey(FEE_SPEC, 'cestiFeeStructure'), true, 'School Fee still owns its fee structure');
assertEq(PC.ownsKey(FEE_SPEC, 'cestiSchoolFeePayments'), true, 'and everything under its prefix');
assertEq(PC.ownsKey(SP_SPEC, 'voctrain_students'), true, 'Student Progress still owns the trainee roll');

console.log('So a push from a reader carries none of the shared data it pulled');
const deviceStore = {
  cestiFeeStructure: '{"Plumbing":{"total":28000}}',
  cestiSchoolFeePayments: '[{"id":"P1"}]',
  voctrain_students: '[{"id":"S1"}]',          // read, not owned
  voctrain_skillAreas: '[{"id":1}]'            // read, not owned
};
const outgoing = PC.collect(FEE_SPEC, deviceStore);
assertEq(Object.keys(outgoing).sort().join(','), 'cestiFeeStructure,cestiSchoolFeePayments',
  'only its own two keys go up — the trainee roll and the centres it pulled do not, ' +
  'so a fee page open on a stale device cannot roll the Centre back');

/* ---------- 6. The two specs really do close the loop ---------- */
console.log('Between them, the fee page and the dashboard each read what the other owns');

FEE_SPEC.reads.forEach(k => {
  assert(PC.ownsKey(SP_SPEC, k), 'Student Progress owns ' + k + ', which School Fee reads');
});
SP_SPEC.reads.forEach(k => {
  assert(PC.ownsKey(FEE_SPEC, k), 'School Fee owns ' + k + ', which Student Progress reads');
});

/* ---------- 7. The real thing: pull it, against a stubbed Drive ---------- */

function runtimeTests() {
  console.log('\nAnd end to end, against a stubbed Drive folder:');

  // A device where School Fee has its own data but has NEVER seen the
  // dashboard's — exactly the machine this whole change is about.
  const local = {
    schoolDashboardGoogleAccessToken: 'tok',
    schoolDashboardGoogleTokenExpiry: new Date(Date.now() + 3600e3).toISOString(),
    cestiFeeStructure: '{"Plumbing":{"total":28000}}',
    voctrain_skillAreas: '[]',
    voctrain_students: '[]'
  };
  const writes = [];
  global.CESTISStore = {
    getItem: k => (Object.prototype.hasOwnProperty.call(local, k) ? local[k] : null),
    setItem: (k, v) => { local[k] = String(v); writes.push(k); },
    keys: () => Object.keys(local)
  };
  global.CESTISCore = Core;

  // The Centre's Drive folder: the dashboard has centres, a deletion and a roll.
  const DRIVE = {
    'CESTIS_Student_Progress.json': {
      data: {
        voctrain_skillAreas: '[{"id":1,"name":"Plumbing"},{"id":2,"name":"Welding"}]',
        voctrain_deletedCentreIds: '["3"]',
        voctrain_students: '[{"id":"S1","name":"Ann Brown"}]',
        voctrain_attendance: '[{"id":"A1"}]',       // owned there, not read here
        voctrain_studentProfiles: '{"S1":{}}'       // likewise
      },
      stamps: {
        voctrain_skillAreas: '2026-08-02T10:00:00.000Z',
        voctrain_deletedCentreIds: '2026-08-02T10:00:00.000Z',
        voctrain_students: '2026-08-02T10:00:00.000Z',
        voctrain_attendance: '2026-08-02T10:00:00.000Z',
        voctrain_studentProfiles: '2026-08-02T10:00:00.000Z'
      }
    }
  };

  const fetched = [];
  global.fetch = function (url, opts) {
    fetched.push(url);
    const listing = /files\?q=/.test(url);
    if (listing) {
      const name = decodeURIComponent(url).match(/name='([^']+)'/)[1];
      return Promise.resolve({ ok: true, json: () =>
        Promise.resolve({ files: DRIVE[name] ? [{ id: 'id-' + name }] : [] }) });
    }
    const media = url.match(/files\/id-([^?]+)\?alt=media/);
    if (media) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(DRIVE[media[1]]) });
    }
    // Any upload: accept but record, so we can prove nothing shared went up.
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'new' }) });
  };

  delete require.cache[require.resolve('../cestis-page-cloud.js')];
  const PageCloud = require('../cestis-page-cloud.js');

  // Opening the page is what must fetch the shared data — not some extra call
  // a developer has to remember, so this drives the ordinary init lifecycle.
  const restored = [];
  const pg = PageCloud.init(Object.assign({}, FEE_SPEC, {
    onRestore: function (changed) { restored.push.apply(restored, changed); }
  }));
  assert(!!pg, 'the fee page registers with the cloud module');

  const settle = () => new Promise(r => setTimeout(r, 30));

  return settle().then(() => {
    console.log('Opening the page pulls the collections it reads but does not own');
    assertEq(restored.slice().sort().join(','),
      'voctrain_deletedCentreIds,voctrain_skillAreas,voctrain_students',
      'the three it reads that the dashboard file actually carries, reported to ' +
      'onRestore so the page re-renders with them');

    assert(local.voctrain_skillAreas.indexOf('Welding') !== -1,
      "the Centre's training centres are now on this device — before this change " +
      'the fee page ran on an empty local list and offered no programmes at all');
    assertEq(local.voctrain_deletedCentreIds, '["3"]',
      'and the record of what was deleted came with them, so a deleted centre ' +
      'does not reappear here');
    assert(local.voctrain_students.indexOf('Ann Brown') !== -1, 'as did the trainee roll');

    console.log("It takes nothing else out of the other page's file");
    assertEq(local.voctrain_attendance, undefined,
      'the attendance register is not this page\'s business and was not adopted');
    assertEq(local.voctrain_studentProfiles, undefined, 'nor were the profiles');

    console.log('It asked Drive for one file, not one request per key');
    const media = fetched.filter(u => /alt=media/.test(u));
    assertEq(media.length, 1, 'the three keys came from a single download');

    console.log('And what it would push carries none of it');
    const outgoing = PC.collect(FEE_SPEC, local);
    Object.keys(outgoing).forEach(k => {
      assert(!PC.isShared(k) || PC.ownsKey(FEE_SPEC, k),
        k + ' is only pushed because this page owns it');
    });
    assert(!('voctrain_skillAreas' in outgoing),
      'the centres it just pulled are NOT sent back up, so a reader can never ' +
      'overwrite the page that owns them');
    assert(!('voctrain_students' in outgoing), 'and neither is the trainee roll');

    /* The operating books: the CMC Board oversees them and operates none, so
       it is a pure reader. A collection whose key names are GENERATED — the
       Cashbook writes one blob per quarter — cannot be asked for by name, so
       it is read by prefix with a trailing star. */
    console.log('The operating books can be read, including generated key names');
    assertEq(PC.sourceOf('cestisPayroll').file, 'CESTIS_Staff_Payslips.json', 'payroll resolves to the payslip page');
    assertEq(PC.sourceOf('cestisTimeRecords').file, 'CESTIS_Staff_TimeClock.json', 'time records resolve to the clock-in page');
    assertEq(PC.sourceOf('cesti_virements').file, 'CESTIS_Virement_Requests.json', 'virements resolve to their own page');
    assertEq(PC.sourceOf('cestis_quarter_2025/2026_Q1').file, 'CESTIS_Cashbook.json', 'a generated quarter key resolves by prefix');
    assertEq(PC.sourceOf('cestis_quarter_*').file, 'CESTIS_Cashbook.json', 'and so does the star form a reader asks with');
    assert(PC.isShared('cestis_quarter_2025/2026_Q3'), 'a quarter is a shared collection');
    assertEq(PC.sourceOf('some_page_local_key'), null, 'a page-local key still belongs to nobody');

    const boardPlan = PC.sharedPullPlan(
      ['cestisPayroll', 'cestisTimeRecords', 'cesti_virements', 'cestis_quarter_*'],
      'CESTIS_CMC_Oversight.json');
    assertEq(boardPlan.length, 4, 'the board pulls four files, one per operating book');
    const cashPlan = boardPlan.find(p2 => p2.file === 'CESTIS_Cashbook.json');
    assertEq(cashPlan.keys[0], 'cestis_quarter_*', 'the Cashbook entry carries the prefix request');

    const cashFile = {
      'cestis_quarter_2025/2026_Q1': '{"transactions":[]}',
      'cestis_quarter_2025/2026_Q2': '{"transactions":[]}',
      cestis_active_quarter: '{"fy":"2025/2026","q":2}',
      cesti_cashbook_data: '[]'
    };
    const picked = PC.pickShared(cashFile, cashPlan.keys);
    assertEq(Object.keys(picked).length, 2, 'a star request takes every quarter the file holds…');
    assert(!('cestis_active_quarter' in picked), '…and nothing else out of the owning page\'s file');

    console.log('A second pull with nothing new changes nothing');
    return pg.pullShared().then(again => {
      assertEq(again.length, 0, 'the merge is idempotent — no churn, no re-upload');

      console.log('With no Drive token the page simply stays local');
      delete local.schoolDashboardGoogleAccessToken;
      return pg.pullShared().then(offline => {
        assertEq(offline.length, 0, 'nothing pulled, nothing thrown');
        console.log('\n' + passed + ' passed, ' + failed + ' failed');
        process.exit(failed ? 1 : 0);
      });
    });
  });
}

runtimeTests().catch(e => {
  console.error('  ✗ FAIL: runtime tests threw — ' + e.stack);
  process.exit(1);
});
