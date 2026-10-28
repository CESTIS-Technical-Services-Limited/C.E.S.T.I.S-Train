/* Staff time clock: a one-person cloud file is merged, never assigned over
   the whole staff list and everybody's hours.

   Each staff member's Drive file holds only that person. Five sync paths (the
   sign-in "Sync Now", Connect, Sync from Cloud, the selective sync and the
   sign-in page sync) did `staffMembers = backupData.data.staffMembers` and
   `timeRecords = backupData.data.timeRecords`. After Mary pressed Sync on the
   shared office PC only Mary could sign in there, every other staff member's
   hours were gone, and page-cloud pushed the one-person list to every PC.

   Also pinned: an administrator's correction to a session is dated
   (lastModified), so the newest-first merges carry it instead of keeping the
   uncorrected copy; a session the administrator deleted is written down and
   "Refresh all staff" / the next sync does not bring it back. Both copies of
   the time clock — Staff.Clock.in.html and the one embedded in index.html —
   are checked.

   Run: node tests/clockin-slice-merge.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
const ROOT = path.join(__dirname, '..');

function extractFunction(src, name, where) {
  let at = src.indexOf('\n        function ' + name + '(');
  if (at < 0) at = src.indexOf('\n        async function ' + name + '(');
  if (at < 0) throw new Error(where + ' no longer defines ' + name);
  let depth = 0, i = src.indexOf('{', at);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(at, i + 1);
}

const ADMIN = { id: 'A1', username: 'admin', fullName: 'Admin', role: 'Admin' };
const MARY = { id: 'M1', username: 'mary', fullName: 'Mary Grant', role: 'Staff' };
const JOHN = { id: 'J1', username: 'john', fullName: 'John Brown', role: 'Staff' };
const rec = (id, staffId, mod) => ({ id, staffId, date: '2026-10-19', clockIn: '2026-10-19T08:00:00.000Z',
  clockOut: '2026-10-19T16:00:00.000Z', status: 'completed', lastModified: mod || '2026-10-19T16:00:00.000Z' });

/* ---------- The shared merge ---------- */
console.log('CESTISCore.mergeTimeClock: a slice adds and updates, it never removes');
{
  const local = { staffMembers: [ADMIN, MARY, JOHN], timeRecords: [rec('S1', 'A1'), rec('S2', 'M1'), rec('S3', 'J1')] };
  const cloud = { staffMembers: [MARY], timeRecords: [rec('S2', 'M1', '2026-10-20T09:00:00.000Z'), rec('S4', 'M1')] };
  cloud.timeRecords[0].clockOut = '2026-10-19T17:00:00.000Z';
  const r = Core.mergeTimeClock(local, cloud, {});
  assert(r.staffMembers.length === 3, 'all three staff remain (got ' + r.staffMembers.length + ')');
  assert(r.timeRecords.map(x => x.id).sort().join() === 'S1,S2,S3,S4', 'every session remains, Mary\'s new one added');
  assert(r.timeRecords.find(x => x.id === 'S2').clockOut === '2026-10-19T17:00:00.000Z', 'the newer copy of S2 wins');
  const older = Core.mergeTimeClock(local, { timeRecords: [rec('S3', 'J1', '2026-10-01T00:00:00.000Z')] }, {});
  assert(older.timeRecords.find(x => x.id === 'S3') === local.timeRecords[2], 'an older cloud copy does not replace the local one');
  const live = Object.assign(rec('S5', 'M1', '2026-10-20T08:00:00.000Z'), { status: 'active', clockOut: null });
  const withLive = Core.mergeTimeClock({ timeRecords: [live] },
    { timeRecords: [Object.assign(rec('S5', 'M1', '2026-10-20T10:00:00.000Z'))] }, { activeSessionId: 'S5' });
  assert(withLive.timeRecords[0] === live, 'the session somebody is clocked into is never replaced');
  const del = Core.mergeTimeClock(local, { timeRecords: [rec('S3', 'J1')] }, { deletedIds: ['S3'] });
  assert(!del.timeRecords.some(x => x.id === 'S3') && del.removed === 1, 'a deleted session is dropped and not re-added');
}

/* ---------- The pages ---------- */
const COPIES = [
  { file: 'Staff.Clock.in.html', user: 'currentUser', token: 'googleAccessToken', fileId: 'cloudFileId' },
  { file: 'index.html', user: 'ttc_currentUser', token: 'ttc_googleAccessToken', fileId: 'ttc_cloudFileId' }
];

async function runCopy(c) {
  const src = fs.readFileSync(path.join(ROOT, c.file), 'utf8');
  console.log('\n=== ' + c.file + ' ===');
  ['staffMembers = backupData.data.staffMembers', 'timeRecords = backupData.data.timeRecords',
   'staffMembers = backup.data.staffMembers', 'timeRecords = backup.data.timeRecords'].forEach(s => {
    assert(src.indexOf(s) === -1, c.file + ': no "' + s + '" left');
  });

  const make = (cloud) => {
    const backing = { cestisStaffMembers: JSON.stringify([ADMIN, MARY, JOHN]), cestisTimeRecords: '[]' };
    const store = { getItem: k => (k in backing ? backing[k] : null), setItem: (k, v) => { backing[k] = String(v); }, removeItem: k => { delete backing[k]; } };
    const sb = {
      CESTISCore: Core, CESTISStore: store, staffMembers: [ADMIN, MARY, JOHN],
      timeRecords: [rec('S1', 'A1'), rec('S2', 'M1'), rec('S3', 'J1')], currentSession: null,
      document: { getElementById: () => null }, console: { log() {}, warn() {}, error() {} },
      confirm: () => true, Date, Object, Array, String, JSON, Promise, Error
    };
    sb.window = sb;
    sb[c.user] = Object.assign({}, MARY);
    sb[c.token] = 'tok';
    sb[c.fileId] = 'MARYFILE';
    sb.fetch = async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(cloud)) });
    const noop = () => {};
    ['setCloudSyncing', 'ttc_setCloudSyncing', 'updateLastSyncDisplay', 'ttc_updateLastSyncDisplay', 'updateLastSavedByDisplay',
     'ttc_updateLastSavedByDisplay', 'renderTodayLog', 'renderHistory', 'renderStaffTable', 'closeForcedSyncModal',
     'ttc_closeForcedSyncModal', 'showToast', 'ttc_showToast', 'loadEditableRecords', 'closeEditTimeModal'].forEach(n => { sb[n] = noop; });
    vm.createContext(sb);
    vm.runInContext(['saveStaffMembers', 'saveTimeRecords', 'ttTimeTombs', 'ttRecordTimeTomb', 'ttUnionTimeTombs',
      'ttApplyCloudSlice', 'performForcedSyncAfterConnect', 'deleteTimeRecord']
      .map(n => extractFunction(src, n, c.file)).join('\n\n'), sb);
    sb._backing = backing;
    return sb;
  };

  console.log('Connect\'s sync with Mary\'s one-person file keeps everybody');
  const maryFile = { version: '1.0', data: { staffMembers: [MARY], timeRecords: [rec('S2', 'M1'), rec('S6', 'M1')] } };
  const pg = make(maryFile);
  await pg.performForcedSyncAfterConnect();
  const staff = JSON.parse(pg._backing.cestisStaffMembers || '[]');
  const recs = JSON.parse(pg._backing.cestisTimeRecords || '[]');
  assert(pg.staffMembers.length === 3 && staff.length === 3, c.file + ': all three staff accounts remain (stored ' + staff.length + ')');
  assert(recs.map(r => r.id).sort().join() === 'S1,S2,S3,S6', c.file + ': everybody\'s sessions remain, Mary\'s new one added (got ' + recs.map(r => r.id).join() + ')');

  console.log('A session the administrator deleted does not come back from its owner\'s file');
  const pg2 = make({ version: '1.0', data: { staffMembers: [JOHN], timeRecords: [rec('S3', 'J1')] } });
  pg2[c.user] = Object.assign({}, ADMIN);
  pg2.deleteTimeRecord(2);  // S3
  assert(JSON.parse(pg2._backing.cestisTimeRecordTombstones || '[]').indexOf('S3') !== -1, c.file + ': the deletion is written down');
  await pg2.performForcedSyncAfterConnect();
  assert(!pg2.timeRecords.some(r => r.id === 'S3'), c.file + ': S3 stays deleted after a sync with John\'s file');

  console.log('An administrator\'s correction is dated');
  const edit = extractFunction(src, 'saveTimeRecordEdit', c.file);
  assert(/record\.lastModified = new Date\(\)\.toISOString\(\);/.test(edit), c.file + ': saveTimeRecordEdit stamps lastModified');
  const agg = extractFunction(src, 'ttAggregateAllUserFiles', c.file);
  assert(/ttApplyCloudSlice\(/.test(agg) && !/timeRecords\.push\(r\)/.test(agg), c.file + ': "Refresh all staff" merges through the same rule');
}

(async () => {
  for (const c of COPIES) await runCopy(c);
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
