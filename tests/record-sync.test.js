/* Every collection converges: the newest edit wins and deletions travel.

   Most collections merged add-only. An exam edited on one machine, a grade
   corrected, an announcement fixed, a notification dismissed, a resource
   removed — none of it reached any other device, and a deleted record came
   straight back on the next sync. Each device held its own version of the
   Centre's data and called it synced.

   What these tests pin:
     - a record edited here is stamped on save, by content, without touching
       the hundreds of places that edit records; a record that arrived from
       elsewhere with its own stamp keeps it;
     - a deliberate deletion leaves a tombstone, and the tombstone travels;
       a blanked list or a suspicious sweep never counts as deletions;
     - the merge keeps the strictly newer copy, drops what was deleted after
       its last edit, and treats two unstamped copies the way the old
       add-only merges did (keep ours, fill its blanks);
     - the page runs every add-only collection through that rule, and the
       write to Drive checks the file's version first and recovers a write
       it overtook.

   Run: node tests/record-sync.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const ROOT = path.join(__dirname, '..');
const PAGES = [
  { where: 'index.html', src: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), core: require('../cestis-core.js') },
  { where: 'Offline System/index.html', src: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8'),
    core: require('../Offline System/cestis-core.js') }
];
function extractFunction(src, name, where) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error(where + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
const T1 = '2026-08-01T09:00:00.000Z', T2 = '2026-08-20T09:00:00.000Z', T3 = '2026-09-01T09:00:00.000Z';
const byId = function (r) { return String(r.id); };

/* ---------- 1. The rule, in the core ---------- */
PAGES.forEach(function (page) {
  const S = page.core.sync;
  console.log('Record sync rule (' + page.where.replace('/index.html', '') + ')');

  // Stamping by content.
  let list = [{ id: 'a', title: 'Welding theory' }, { id: 'b', title: 'Safety', updatedAt: T1 }];
  let index = S.stampChanges(list, byId, null, T2);
  assertEq(list[0].updatedAt, undefined, 'taking the baseline stamps nothing');
  list[0].title = 'Welding theory, revised';
  list.push({ id: 'c', title: 'New exam' });
  index = S.stampChanges(list, byId, index, T3);
  assertEq(list[0].updatedAt, T3, 'a record edited here is stamped on save');
  assertEq(list[1].updatedAt, T1, 'an untouched record keeps its stamp');
  assertEq(list[2].updatedAt, T3, 'a record created here is stamped');
  list[1].title = 'Safety (from elsewhere)'; list[1].updatedAt = T2;   // arrived with its own stamp
  index = S.stampChanges(list, byId, index, T3);
  assertEq(list[1].updatedAt, T2, 'a record that arrived with its own newer stamp keeps it');

  // Removals: deliberate, never a blank or a sweep.
  assertEq(S.detectRemovals([list[0], list[2]], byId, index).join(','), 'b', 'a record gone since the baseline is a removal');
  assertEq(S.detectRemovals([], byId, index).length, 0, 'a blanked list is never a deletion');
  let big = []; for (let i = 0; i < 40; i++) big.push({ id: 'r' + i });
  const bigIndex = S.stampChanges(big, byId, null, T1);
  assertEq(S.detectRemovals(big.slice(20), byId, bigIndex).length, 0, 'a sweep of half the collection is not believed');
  assertEq(S.detectRemovals(big.slice(3), byId, bigIndex).length, 3, 'a few removals are');

  // Tombstones: the later removal stands; travels; an edit after a deletion wins.
  const tombs = S.mergeTombstones({ x: T1 }, { x: T2, y: T1 });
  assertEq(tombs.x, T2, 'the later removal of a key stands');
  assertEq(tombs.y, T1, 'a removal only one side knows is kept');
  assert(S.deletedAfter(tombs, 'x', { updatedAt: T1 }), 'a record last edited before its deletion is gone');
  assert(!S.deletedAfter(tombs, 'x', { updatedAt: T3 }), 'a record edited after its deletion lives');
  assert(S.deletedAfter(tombs, 'y', {}), 'an unstamped record yields to a tombstone');

  // The merge.
  let local = [{ id: 'a', title: 'old', updatedAt: T1 }, { id: 'b', title: 'mine', updatedAt: T3 }, { id: 'd', title: 'deleted elsewhere' }, { id: 'e', title: 'legacy', notes: '' }];
  let cloud = [{ id: 'a', title: 'newer', updatedAt: T2 }, { id: 'b', title: 'theirs', updatedAt: T2 }, { id: 'c', title: 'new here' }, { id: 'e', title: 'legacy', notes: 'filled', grades: { s1: 90 } }];
  let out = S.mergeList(local, cloud, byId, { tombs: { d: T2 } });
  assertEq(local.find(r => r.id === 'a').title, 'newer', 'a strictly newer cloud copy replaces the local one');
  assertEq(local.find(r => r.id === 'b').title, 'mine', 'a strictly newer local copy is kept');
  assert(!!local.find(r => r.id === 'c'), 'a record only the cloud has is added');
  assert(!local.find(r => r.id === 'd'), 'a record deleted elsewhere after its last edit is removed');
  assertEq(local.find(r => r.id === 'e').notes, 'filled', 'two unstamped copies: ours is kept and its blanks filled');
  assertEq(local.find(r => r.id === 'e').grades.s1, 90, 'a grade the other copy holds fills in');
  assertEq(out.added + '/' + out.updated + '/' + out.removed, '1/2/1', 'the outcome is counted');
  // A record deleted elsewhere but edited here afterwards lives.
  local = [{ id: 'd', title: 'edited after', updatedAt: T3 }];
  S.mergeList(local, [], byId, { tombs: { d: T2 } });
  assertEq(local.length, 1, 'an edit made after a deletion elsewhere wins');
  // Cloud records that were deleted are not brought back.
  local = [];
  S.mergeList(local, [{ id: 'd', title: 'stale', updatedAt: T1 }], byId, { tombs: { d: T2 } });
  assertEq(local.length, 0, 'a deleted record is not added back from a stale copy');
  // Device-only fields survive a takeover.
  let map = { Welding: { name: 'Welding', bgPage1: 'data:image', updatedAt: T1 } };
  S.mergeMap(map, { Welding: { name: 'Welding NVQ-J', updatedAt: T2 } }, { keep: { bgPage1: 1, bgPage2: 1 } });
  assertEq(map.Welding.name, 'Welding NVQ-J', 'a newer template copy is taken');
  assertEq(map.Welding.bgPage1, 'data:image', 'without losing the image this device holds');
  map = { p1: { bio: 'x', updatedAt: T1 }, gone: { bio: 'y' } };
  const mo = S.mergeMap(map, { p1: { bio: 'z', updatedAt: T2 }, p2: { bio: 'new' } }, { tombs: { gone: T2 } });
  assertEq(map.p1.bio, 'z', 'a map record follows the same rule');
  assertEq(map.gone, undefined, 'and a deleted map entry goes');
  assertEq(mo.added, 1, 'and a new one arrives');

  // Settings: a stamped local copy keeps its scalars against an unstamped or older cloud copy.
  const M = page.core.mergeSystemSettings;
  assertEq(M({ theme: 'dark', updatedAt: T2 }, { theme: 'light', updatedAt: T1 }).theme, 'dark', 'newer local settings keep their values');
  assertEq(M({ theme: 'dark', updatedAt: T1 }, { theme: 'light', updatedAt: T2 }).theme, 'light', 'newer cloud settings arrive');
  assertEq(M({ theme: 'dark' }, { theme: 'light' }).theme, 'light', 'two unstamped copies still converge on the cloud');
  assertEq(M({ theme: 'dark', updatedAt: T1 }, { theme: 'light', other: 1 }).other, 1, 'a key only the cloud has still arrives');
});

/* ---------- 2. The page: stamps on save, tombstones on delete, the rule on every collection ---------- */
console.log('The page stamps on save, writes down deletions and merges every collection by the rule');
PAGES.forEach(function (page) {
  const w = page.where, src = page.src;
  const merge = extractFunction(src, 'mergeBackupData', w);
  ['exams', 'announcements', 'calendarEvents', 'lmsChatRooms', 'driveResources', 'classSessions', 'adminMeetings', 'instructorAssignments',
    'assignmentSubmissions', 'instructorResources', 'instructorData', 'adrTasks', 'supportMessages', 'notifications', 'documentHubFiles'].forEach(function (c) {
    assert(merge.indexOf('CESTISCore.sync.mergeList(' + c + ',') !== -1, w + ': ' + c + ' merges by the rule');
  });
  ['studentProfiles', 'instructorProfiles', 'adrStaffMeta', 'certTemplates', 'lmsChatProfiles'].forEach(function (c) {
    assert(merge.indexOf('CESTISCore.sync.mergeMap(' + c + ',') !== -1, w + ': ' + c + ' merges by the rule');
  });
  assert(merge.indexOf('CESTISCore.cloudMerge.applyApproval(certDownloadApprovals, ca)') !== -1, w + ': approvals use the one shared approval rule');
  assert(merge.indexOf('mergeTombstones(') !== -1, w + ': the cloud\'s tombstones are taken in');
  assert(merge.indexOf('syncRebaselineAll()') !== -1, w + ': the baseline is retaken after a merge');
  assert(merge.indexOf('.push(') === -1 || !/\b(exams|announcements|calendarEvents|adminMeetings|adrTasks|notifications|documentHubFiles)\.push\(/.test(merge),
    w + ': no add-only push survives for those collections');
  const save = extractFunction(src, 'saveState', w);
  assert(save.indexOf('syncStampAll()') !== -1 && save.indexOf("'voctrain_syncTombstones'") !== -1, w + ': saveState stamps first and persists the tombstones');
  assert(extractFunction(src, 'loadState', w).indexOf("'voctrain_syncTombstones'") !== -1, w + ': loadState reads them back and takes the baseline');
  assert(extractFunction(src, 'autoSaveToAllFolders', w).indexOf('syncTombstones: syncTombstones') !== -1, w + ': the backup carries them');
  assert(extractFunction(src, 'clearAllSessionData', w).indexOf("'voctrain_syncTombstones'") !== -1, w + ': a logout keeps them');
  const tombSites = (src.match(/syncTombstoneRemoved\('/g) || []).length;
  assert(tombSites >= 13, w + ': every deliberate deletion writes down what it removed (found ' + tombSites + ')');
  const grid = extractFunction(src, 'applyAdminStaffAccess', w);
  assert(grid.indexOf('nextAt < haveAt') !== -1 && grid.indexOf("k === 'updatedAt'") !== -1, w + ': a stale Admin Staff grid never revokes what was since granted');

  // Run the page's own stamping over a stubbed dataset.
  const names = ['syncKeyById', 'syncCollections', 'syncStampAll', 'syncRebaselineAll', 'syncRecordTombstone', 'syncTombstoneRemoved', 'syncTombsFor'];
  const sandbox = { CESTISCore: page.core, console: console, window: {}, syncTombstones: {}, _syncIndex: {},
    exams: [{ id: 'EXAM-1', title: 'Welding Theory', course: 'Welding' }, { id: 'EXAM-2', title: 'Safety', course: 'Welding', updatedAt: T1 }],
    announcements: [{ id: 'ANN-1', title: 'Term starts' }], calendarEvents: [], lmsChatRooms: [], driveResources: [], classSessions: [], adminMeetings: [],
    instructorAssignments: [{ id: 'AS-1', title: 'Essay', grades: { s1: 70 } }], assignmentSubmissions: [], instructorResources: [], instructorData: [], adrTasks: [],
    supportMessages: [], notifications: [{ id: 'N-1', text: 'hello' }, { id: 'N-2', text: 'world' }], documentHubFiles: [],
    studentProfiles: { S1: { phone: '1' } }, instructorProfiles: {}, adrStaffMeta: {}, certTemplates: { Welding: { name: 'W', bgPage1: 'img' } }, lmsChatProfiles: {},
    systemSettings: { theme: 'light', maintenanceMode: false, maintenanceUpdatedAt: T1 }, adminStaffAccessSettings: { students: true } };
  sandbox.window.CESTISCore = page.core;
  vm.createContext(sandbox);
  vm.runInContext(names.map(function (n) { return extractFunction(src, n, w); }).join('\n'), sandbox);
  vm.runInContext('syncRebaselineAll()', sandbox);
  vm.runInContext('syncStampAll()', sandbox);
  assertEq(sandbox.exams[0].updatedAt, undefined, w + ': a save right after load stamps nothing');
  vm.runInContext("exams[0].title = 'Welding Theory (revised)'; instructorAssignments[0].grades.s1 = 85; studentProfiles.S1.phone = '2'; certTemplates.Welding.bgPage1 = 'other-image'; systemSettings.theme = 'dark'; systemSettings.maintenanceUpdatedAt = '" + T2 + "'; adminStaffAccessSettings.exams = true; notifications = notifications.filter(function(n){ return n.id !== 'N-2'; }); syncStampAll()", sandbox);
  assert(!!sandbox.exams[0].updatedAt, w + ': an edited exam is stamped');
  assertEq(sandbox.exams[1].updatedAt, T1, w + ': an untouched exam is not');
  assert(!!sandbox.instructorAssignments[0].updatedAt, w + ': a changed grade stamps the assignment');
  assert(!!sandbox.studentProfiles.S1.updatedAt, w + ': an edited profile is stamped');
  assertEq(sandbox.certTemplates.Welding.updatedAt, undefined, w + ': a template whose only change is its device-held image is not stamped');
  assert(!!sandbox.systemSettings.updatedAt, w + ': changed settings are stamped');
  assert(!!sandbox.adminStaffAccessSettings.updatedAt, w + ': a changed access grid is stamped');
  assertEq(!!(sandbox.syncTombstones.notifications && sandbox.syncTombstones.notifications['N-2']), true, w + ': a removed notification leaves a tombstone');
  vm.runInContext("systemSettings.maintenanceMode = true; systemSettings.maintenanceUpdatedAt = '" + T3 + "'; var before = systemSettings.updatedAt; syncStampAll(); stampAfterMaint = systemSettings.updatedAt === before;", sandbox);
  assertEq(sandbox.stampAfterMaint, true, w + ': a maintenance decision does not re-stamp the settings (it carries its own stamp)');
  vm.runInContext("syncTombstoneRemoved('exams', exams, exams = exams.filter(function(e){ return e.id !== 'EXAM-2'; }))", sandbox);
  assert(!!(sandbox.syncTombstones.exams && sandbox.syncTombstones.exams['safety|welding']), w + ': a deliberate deletion is written down under the merge key');
});

/* ---------- 3. The write checks the version first, and recovers a write it overtook ---------- */
console.log('A write to Drive checks the version first and recovers a write it overtook');
PAGES.forEach(function (page) {
  const w = page.where, src = page.src;
  const auto = extractFunction(src, 'autoSaveToAllFolders', w);
  assert(auto.indexOf('var buildPayload = function()') !== -1 && auto.indexOf('let backupData = buildPayload();') !== -1, w + ': the payload can be rebuilt');
  assert(auto.indexOf('if (await mainMovedSincePull()) { backupData = buildPayload(); }') !== -1, w + ': the Main version is re-read right before the write and the payload rebuilt on a change');
  const moved = extractFunction(src, 'mainMovedSincePull', w);
  assert(moved.indexOf('?fields=version') !== -1 && moved.indexOf('await silentMergeFromBackup(fileId)') !== -1, w + ': a moved file is merged in before the save');
  const save = extractFunction(src, 'silentSaveToFolder', w);
  assert(save.indexOf('Number(pResult.version) - Number(prevVer) > 1') !== -1 && save.indexOf('recoverOvertakenWrite(') !== -1, w + ': a version jump of more than one is recovered');
  const rec = extractFunction(src, 'recoverOvertakenWrite', w);
  assert(rec.indexOf('/revisions?fields=') !== -1 && rec.indexOf('revs[revs.length - 2]') !== -1 && rec.indexOf('mergeBackupData(') !== -1 && rec.indexOf('_lastAutoSaveHash = null') !== -1,
    w + ': the overtaken revision is fetched, merged, and the union queued for the next tick');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
