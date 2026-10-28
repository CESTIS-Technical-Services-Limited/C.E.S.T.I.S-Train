/* Clearing a trainee's device that already holds everything — without ever
   losing unsent work.

   Every device that synced before the gate holds the whole Centre: every
   trainee's records, every account's password check and two-step secret,
   every answer key (DESIGN.md §1.1). Once a trainee signs in through the
   gate on a device that is not a staff device, those copies should go
   (§7.3) — but only after anything the device still holds unsent has been
   delivered, and never when anything is unclear.
   Core.gate.cleanupPlan(storeKeys, markers) decides; the page (Stage 5)
   acts, and first only reports.

   Pinned here:
     - nothing is removed unless the gate is on, the trainee has just signed
       in through it, the device is not a staff device, and no staff work
       waits to be uploaded (a trainee's own note does not hold it back);
     - while any unsent work has no delivery receipt, nothing is removed,
       and the plan names what must be sent first;
     - once every receipt is in: the Centre's collections, the accounts
       list, fees, payroll, finance, the Centre's stored sign-in and the
       delivered work go; the gate's own keys, the trainee's namespace,
       session keys, display choices and anything unrecognised stay;
     - a key that could not be read defers everything;
     - over random plans: a key holding unsent work without a receipt is
       never in `remove`, and nothing is ever both removed and kept.

   Run: node tests/gate-cleanup.test.js */
'use strict';

const Core = require('../cestis-core.js');
const { makeCentre } = require('./gate-fixture.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const G = Core.gate;
const C = makeCentre(Core);

// What a lab PC that synced holds, as the main namespace's keys.
const CENTRE = Object.keys(C.store).concat(['voctrain_attendance', 'voctrain_attendance::2026_Q3', 'voctrain_deletedStudentAt', 'voctrain_user_USR-T04_chatMessages',
  'voctrain_user_USR-T01_studentProfiles', 'cestiSchoolFeeStudents', 'cestiFeeStructure', 'cestisPayroll', 'cesti_virements', 'cestis_finance_invoices',
  'cestis_quarter_2026_Q3', 'cestisTimeRecords', 'cestis_cmc_rulings', 'schoolDashboardGoogleAccessToken', 'schoolDashboardGoogleTokenExpiry',
  'cestisGoogleAccessToken', 'schoolDashboardCloudFileId', 'schoolDashboardLastSyncTime', 'dashboardUsers']);
const DEVICE = ['cestisTheme', 'darkMode', 'voctrain_sessionRole', 'voctrain_sessionUserId', 'voctrain_sessionExpiry', 'voctrain_extSysCertHelpSeen_x',
  'cestisGateNs', 'cestisGateToken', 'cestisDeviceKind', 'cestisGateAddress', 'cestisGateQuarantine', 'g1::voctrain_students', 'g1::cestisGateSessionKey',
  'cestis_pagecloud_stamps__CESTIS_LMS_Dashboard.json', 'cestisPendingUpload', 'some-future-key', 'vcChatHistory_ROOM1'];
const UNSENT = ['cestisExamOutbox', 'cestisExamSession__STU-a__EX1', 'voctrain_support_messages', 'voctrain_examInProgress'];
const KEYS = Array.from(new Set(CENTRE.concat(DEVICE, UNSENT, ['__cestis_idb_only__:voctrain_examResults', '__cestis_idb_only__:cestisTheme'])));
const ready = (over) => Object.assign({ gateOn: true, viaGate: true, deviceKind: null, pendingUpload: null,
  unsent: { cestisExamOutbox: true, 'cestisExamSession__STU-a__EX1': true, voctrain_support_messages: true },
  receipts: { cestisExamOutbox: true, 'cestisExamSession__STU-a__EX1': true, voctrain_support_messages: true }, unreadable: [] }, over || {});
const sorted = a => a.slice().sort();

/* ------------------------------------------------------- when to wait */
console.log('Nothing is removed until the gate is on and it is sure');
[
  ['gate-off', { gateOn: false }, 'the gate is off'],
  ['not-a-gate-sign-in', { viaGate: false }, 'the trainee did not sign in through the gate'],
  ['staff-device', { deviceKind: 'staff' }, 'a staff member has signed in on this device'],
  ['staff-work-not-uploaded', { pendingUpload: 'instructor|2026-11-02T10:00:00Z' }, 'an instructor\'s work waits to be uploaded'],
  ['unreadable', { unreadable: ['voctrain_examResults'] }, 'a key could not be read']
].forEach(([why, over, label]) => {
  const p = G.cleanupPlan(KEYS, ready(over));
  assertEq([p.defer, p.remove], [why, []], label + ': it waits (' + why + ') and removes nothing');
  assertEq(sorted(p.keep), sorted(KEYS), 'and keeps every key');
});
{
  const p = G.cleanupPlan(KEYS, ready({ pendingUpload: 'student|2026-11-02T10:00:00Z' }));
  assertEq(p.defer, null, 'a trainee\'s own "not yet uploaded" note does not hold it back (their work is in the outbox)');
}

/* --------------------------------------------------- unsent work first */
console.log('Unsent work is sent first; until every receipt is in, nothing goes');
{
  const p = G.cleanupPlan(KEYS, ready({ receipts: { cestisExamOutbox: true } }));
  assertEq([p.defer, p.remove, sorted(p.send)], ['unsent-work', [], sorted(['cestisExamSession__STU-a__EX1', 'voctrain_support_messages'])],
    'two still unsent: it waits, and says what to send');
  const q = G.cleanupPlan(KEYS, ready({ receipts: {} }));
  assertEq([q.defer, sorted(q.send)], ['unsent-work', sorted(['cestisExamOutbox', 'cestisExamSession__STU-a__EX1', 'voctrain_support_messages'])], 'none sent yet');
}

/* --------------------------------------------------- once it is sure */
console.log('Then the Centre\'s copies go, and the device\'s own things stay');
{
  const p = G.cleanupPlan(KEYS, ready());
  assertEq(p.defer, null, 'every receipt in: it goes ahead');
  const removed = {}; p.remove.forEach(k => { removed[k] = 1; });
  ['voctrain_users', 'voctrain_students', 'voctrain_exams', 'voctrain_examResults', 'voctrain_attendance::2026_Q3', 'voctrain_user_USR-T04_chatMessages',
    'cestiSchoolFeeStudents', 'cestisPayroll', 'cesti_virements', 'cestis_finance_invoices', 'cestis_quarter_2026_Q3', 'cestis_cmc_rulings',
    'schoolDashboardGoogleAccessToken', 'cestisGoogleAccessToken', 'schoolDashboardCloudFileId', 'schoolDashboardLastSyncTime', 'dashboardUsers'].forEach(k => {
    assert(removed[k], k + ' goes');
  });
  ['cestisExamOutbox', 'cestisExamSession__STU-a__EX1', 'voctrain_support_messages'].forEach(k => assert(removed[k], k + ' goes once delivered'));
  assert(removed['__cestis_idb_only__:voctrain_examResults'], 'a removed key\'s "kept in IndexedDB" marker goes with it');
  DEVICE.concat(['__cestis_idb_only__:cestisTheme', 'voctrain_examInProgress']).forEach(k => assert(!removed[k], k + ' stays'));
  assertEq(sorted(p.keep.concat(p.remove)), sorted(KEYS), 'every key is either kept or removed');
  assertEq(G.cleanupPlan([], ready()).remove, [], 'an empty device: nothing to do');
}

/* -------------------------------------------------------- random plans */
console.log('Over random plans: unsent work without a receipt is never removed');
{
  let seed = 7;
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  let violations = 0, overlap = 0, runs = 0;
  for (let i = 0; i < 2000; i++) {
    const keys = KEYS.filter(() => rnd() < 0.7);
    const unsent = {}, receipts = {};
    keys.forEach(k => { if (rnd() < 0.25) unsent[k] = true; if (rnd() < 0.5) receipts[k] = true; });
    const p = G.cleanupPlan(keys, { gateOn: rnd() < 0.9, viaGate: rnd() < 0.9, deviceKind: rnd() < 0.1 ? 'staff' : null,
      pendingUpload: rnd() < 0.1 ? 'admin|x' : null, unsent, receipts, unreadable: rnd() < 0.05 ? ['x'] : [] });
    runs++;
    p.remove.forEach(k => { if (unsent[k] && !receipts[k]) violations++; if (p.keep.indexOf(k) !== -1) overlap++; });
    if (p.remove.length && p.defer) violations++;
  }
  assertEq([violations, overlap], [0, 0], runs + ' random plans: no unsent work removed, nothing both kept and removed, nothing removed while waiting');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
