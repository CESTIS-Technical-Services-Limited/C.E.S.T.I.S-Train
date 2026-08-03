/* Unit tests for CESTISCore.cloudMerge — the rules the narrower sync paths
   have to follow so a sync never undoes work that was already done.

   The main autosave/merge pair already converged correctly. Three other paths
   did not, and each could quietly reverse something a person had done:
     - the pre-login account fetch replaced student records outright;
     - that path and the trainee's "Refresh from Cloud" replaced the
       certificate-download approval outright;
     - every merge re-added training centres that had been deleted.

   Run: node tests/cloud-merge.test.js */
'use strict';

const Core = require('../cestis-core.js');
const CM = Core.cloudMerge;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* ---------- 1. Student records merge, they do not replace ---------- */
console.log('A sync never discards local work on a student');
const OLD = '2026-07-01T09:00:00.000Z';
const NEW = '2026-08-01T09:00:00.000Z';

/* An instructor marks attendance and moves the trainee on, on this device. The
   cloud copy is older. Replacing outright — what the pre-login fetch did —
   rolled both of those back the next time anybody signed in. */
let local = [{ id: 'STU-1', name: 'John Smith', course: 'Welding', stage: 'assessment', attendance: 88, lastModified: NEW }];
let res = CM.applyStudent(local, { id: 'STU-1', name: 'John Smith', course: 'Welding', stage: 'training', attendance: 40, lastModified: OLD });
assertEq(res, 'merged', 'an existing record is merged');
assertEq(local.length, 1, 'no duplicate is created');
assertEq(local[0].stage, 'assessment', 'the newer local stage survives the sync');
assertEq(local[0].attendance, 88, 'the newer local attendance survives the sync');

/* The other direction still works: a genuinely newer cloud edit wins. */
local = [{ id: 'STU-1', name: 'John Smith', course: 'Welding', stage: 'training', lastModified: OLD }];
CM.applyStudent(local, { id: 'STU-1', name: 'John Smith', course: 'Welding', stage: 'certified', certNo: 'C-99', lastModified: NEW });
assertEq(local[0].stage, 'certified', 'a newer cloud edit is taken');
assertEq(local[0].certNo, 'C-99', 'and its new fields arrive');

/* Blanks are filled from whichever copy has the value, so neither side loses. */
local = [{ id: 'STU-1', name: 'John Smith', course: 'Welding', phone: '876-555-0000', email: '', lastModified: NEW }];
CM.applyStudent(local, { id: 'STU-1', name: 'John Smith', course: 'Welding', phone: '', email: 'js@mail.com', lastModified: OLD });
assertEq(local[0].phone, '876-555-0000', 'the local phone number is kept');
assertEq(local[0].email, 'js@mail.com', 'and the cloud email fills the blank');

/* New records still arrive, and deleted trainees stay deleted. */
local = [];
assertEq(CM.applyStudent(local, { id: 'STU-2', name: 'Ann Brown' }), 'added', 'an unseen trainee is added');
assertEq(local.length, 1, 'and lands in the list');
const gone = function (s) { return s.id === 'STU-3'; };
assertEq(CM.applyStudent(local, { id: 'STU-3', name: 'Deleted Person' }, gone), 'skipped', 'a deleted trainee is not resurrected');
assertEq(local.length, 1, 'and is not added back');
assertEq(CM.applyStudent(null, { id: 'X' }), 'skipped', 'null-safe');
assertEq(CM.applyStudent([], null), 'skipped', 'null cloud record is safe');

/* ---------- 2. An approval is never switched back off ---------- */
console.log('A sync never revokes a certificate approval');
/* The administrator approves a trainee for download. Another device still
   holds the older "not approved yet" row. Replacing outright meant that row
   won and the trainee's Download button went dark again. */
const approved = { studentId: 'STU-1', approved: true, approvedDate: '2026-08-01T10:00:00.000Z' };
const notYet = { studentId: 'STU-1', approved: false };
assertEq(CM.bestApproval(approved, notYet), approved, 'approved beats not-approved');
assertEq(CM.bestApproval(notYet, approved), approved, 'whichever way round they arrive');
assertEq(CM.bestApproval(null, notYet), notYet, 'null-safe on the left');
assertEq(CM.bestApproval(approved, null), approved, 'null-safe on the right');

/* Between two approvals, the most recent decision wins. */
const older = { studentId: 'STU-1', approved: true, approvedDate: '2026-07-01T10:00:00.000Z' };
const newer = { studentId: 'STU-1', approved: true, approvedDate: '2026-08-01T10:00:00.000Z' };
assertEq(CM.bestApproval(older, newer), newer, 'the later approval wins');
assertEq(CM.bestApproval(newer, older), newer, 'order makes no difference');

let approvals = [{ studentId: 'STU-1', approved: true, approvedDate: '2026-08-01T10:00:00.000Z' }];
assertEq(CM.applyApproval(approvals, { studentId: 'STU-1', approved: false }), 'merged', 'the stale row is merged, not taken');
assertEq(approvals[0].approved, true, 'the trainee keeps their approval');
assertEq(CM.applyApproval(approvals, { studentId: 'STU-2', approved: true }), 'added', 'a new approval arrives');
assertEq(approvals.length, 2, 'and is added');
assertEq(CM.applyApproval(approvals, { approved: true }), 'skipped', 'an approval with no trainee is ignored');
assertEq(CM.applyApproval(null, { studentId: 'X' }), 'skipped', 'null-safe');

/* ---------- 3. A deleted training centre stays deleted ---------- */
console.log('A deleted training centre stays deleted');
let centres = [{ id: 1, name: 'Welding & Fabrication', desc: 'old text', icon: '🔥', color: '#e74c3c' }];
let out = CM.applySkillAreas(centres, [
  { id: 1, name: 'Welding & Fabrication', desc: 'SMAW, MIG, TIG', startDate: '2026-09-01', endDate: '2027-06-30' },
  { id: 2, name: 'Plumbing', desc: 'Pipe fitting' }
]);
assertEq(out.added, 1, 'an unseen centre is added');
assertEq(centres.length, 2, 'and lands in the list');
assertEq(centres[0].desc, 'SMAW, MIG, TIG', 'an edited description reaches this path');
assertEq(centres[0].startDate, '2026-09-01', 'and so do the intake dates — add-only never delivered these');

/* The deletion is honoured, which is the whole point: without it the centre
   came back on the next sync, chat room and all. */
centres = [{ id: 1, name: 'Welding & Fabrication' }];
const centreDeleted = function (id) { return String(id) === '2'; };
out = CM.applySkillAreas(centres, [{ id: 2, name: 'Plumbing' }], centreDeleted);
assertEq(out.skipped, 1, 'the deleted centre is skipped');
assertEq(centres.length, 1, 'and is not resurrected');
out = CM.applySkillAreas(centres, [{ id: 3, name: 'Masonry' }], centreDeleted);
assertEq(centres.length, 2, 'other centres still arrive normally');

/* Blank cloud fields never wipe a centre's real values. */
centres = [{ id: 1, name: 'Welding & Fabrication', desc: 'SMAW, MIG, TIG', endDate: '2027-06-30' }];
CM.applySkillAreas(centres, [{ id: 1, name: '', desc: '', endDate: '' }]);
assertEq(centres[0].name, 'Welding & Fabrication', 'a blank cloud name does not erase the local one');
assertEq(centres[0].desc, 'SMAW, MIG, TIG', 'nor a blank description');
assertEq(centres[0].endDate, '2027-06-30', 'nor a blank end date');

assertEq(CM.applySkillAreas(null, []).added, 0, 'null-safe');
assertEq(CM.applySkillAreas([], null).added, 0, 'null cloud list is safe');

/* ---------- 3b. The course duration reaches every device ---------- */
/* The dates decide whether a course has ended, and therefore whether its
   trainees are Not Yet Competent. When each device kept its own copy of them,
   the same trainee showed a different status on every machine. */
console.log('The course duration is merged, newest edit first');

const T1 = '2026-08-01T09:00:00.000Z';   // earlier admin edit
const T2 = '2026-08-03T09:00:00.000Z';   // later admin edit

centres = [{ id: 1, name: 'Welding L2', startDate: '2025-09-01', endDate: '2026-06-30', durationModified: T1 }];
CM.applySkillAreas(centres, [{ id: 1, name: 'Welding L2', startDate: '2026-09-01', endDate: '2027-06-30', durationModified: T2 }]);
assertEq(centres[0].endDate, '2027-06-30', 'a later edit is adopted');
assertEq(centres[0].startDate, '2026-09-01', 'both dates move together');
assertEq(centres[0].durationModified, T2, 'and the stamp comes with it');

centres = [{ id: 1, name: 'Welding L2', startDate: '2026-09-01', endDate: '2027-06-30', durationModified: T2 }];
CM.applySkillAreas(centres, [{ id: 1, name: 'Welding L2', startDate: '2025-09-01', endDate: '2026-06-30', durationModified: T1 }]);
assertEq(centres[0].endDate, '2027-06-30', 'an older edit does not undo a newer one');
assertEq(centres[0].durationModified, T2, 'the stamp stands');

console.log('A device that was never told the dates cannot push its own over them');

centres = [{ id: 1, name: 'Welding L2', startDate: '2026-09-01', endDate: '2027-06-30', durationModified: T2 }];
CM.applySkillAreas(centres, [{ id: 1, name: 'Welding L2', startDate: '2020-01-01', endDate: '2021-01-01' }]);
assertEq(centres[0].endDate, '2027-06-30', 'an unstamped copy never overwrites a stamped one');

console.log('Dates saved before they were stamped still travel');

centres = [{ id: 1, name: 'Welding L2' }];
CM.applySkillAreas(centres, [{ id: 1, name: 'Welding L2', startDate: '2026-09-01', endDate: '2027-06-30' }]);
assertEq(centres[0].endDate, '2027-06-30', 'with no stamps anywhere the cloud copy is taken, as it always was');

centres = [{ id: 1, name: 'Welding L2', level: 'Level 2', project: 'Old' }];
CM.applySkillAreas(centres, [{ id: 1, name: 'Welding L2', level: 'Level 3', project: 'Workshop Rebuild', durationModified: T2 }]);
assertEq(centres[0].level, 'Level 3', 'the level travels with the duration');
assertEq(centres[0].project, 'Workshop Rebuild', 'and so does the project');

console.log('A reopen window granted to an instructor reaches the other devices');

centres = [{ id: 1, name: 'Welding L2', instructorPermissions: [{ instructor: 'A. Brown', expiresAtMs: 111 }] }];
CM.applySkillAreas(centres, [{ id: 1, name: 'Welding L2', instructorPermissions: [
  { instructor: 'A. Brown', expiresAtMs: 111 },              // already known
  { instructor: 'C. Grant', expiresAtMs: 222 }               // granted elsewhere
] }]);
assertEq(centres[0].instructorPermissions.length, 2, 'the new window is added, the known one not duplicated');
CM.applySkillAreas(centres, [{ id: 1, name: 'Welding L2', instructorPermissions: [] }]);
assertEq(centres[0].instructorPermissions.length, 2, 'and an empty cloud list never revokes one');

/* ---------- 4. Repeating a sync changes nothing further ---------- */
console.log('Syncing twice is the same as syncing once');
const cloudStudents = [{ id: 'STU-1', name: 'John Smith', course: 'Welding', stage: 'certified', lastModified: NEW }];
const cloudApprovals = [{ studentId: 'STU-1', approved: true, approvedDate: NEW }];
const cloudCentres = [{ id: 1, name: 'Welding & Fabrication', desc: 'SMAW' }];
let S = [], A = [], C = [];
for (let pass = 0; pass < 3; pass++) {
  cloudStudents.forEach(function (cs) { CM.applyStudent(S, cs); });
  cloudApprovals.forEach(function (ca) { CM.applyApproval(A, ca); });
  CM.applySkillAreas(C, cloudCentres);
}
assertEq(S.length, 1, 'three passes leave one student');
assertEq(A.length, 1, 'three passes leave one approval');
assertEq(C.length, 1, 'three passes leave one centre');
assertEq(S[0].stage, 'certified', 'and the values are stable');
assertEq(A[0].approved, true, 'the approval is stable');

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
