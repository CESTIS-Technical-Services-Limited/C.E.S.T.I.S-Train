/* The full backup file is an administrator's, and restoring one merges it.

   What happened (accounts-12, accounts-21 in the audit):
     - Ctrl+Shift+E downloaded the whole store for ANY role — a trainee signed
       in on her laptop, or whoever sat at a shared PC's sign-in page: every
       account's hash, two-step secret and backup codes, every trainee, the
       exams with their answers, the fee and payroll books (reproduced in
       headless Chromium with a student session);
     - "Import Backup" wrote every key in the file over the device: last
       month's export put every account back on last month's password and
       status, and brought back everything deleted since.

   Pinned here (root index.html and cestis-core.js):
     - exportDataBackup and importDataBackup refuse anyone but a signed-in
       administrator (the keyboard shortcut goes through exportDataBackup);
     - CESTISCore.backupRestore merges: deletion lists are unioned, records
       are merged record by record (a newer local copy is never replaced), maps
       only gain entries, nothing empty is written over anything;
     - importDataBackup applies the merge, deletion lists first.

   Run: node tests/backup-export-import.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const Core = require('../cestis-core.js');
const R = Core.backupRestore;

function extractFunction(src, name) {
  const re = new RegExp('(?:async\\s+)?function ' + name + '\\(');
  const m = re.exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

/* ---------- 1. Export: administrators only ---------- */
console.log('Only a signed-in administrator can export the whole store');
function tryExport(role, user) {
  const made = [];
  const sb = { currentRole: role, currentLoggedInUser: user, showToast: function () {},
    CESTISStore: { getItem: function () { return '[{"id":"x"}]'; }, keys: function () { return []; } },
    safeJsonParse: function (v) { return JSON.parse(v); }, localDateStr: function () { return '2026-10-20'; },
    Blob: function (parts) { made.push(parts); }, URL: { createObjectURL: function () { return 'blob:'; }, revokeObjectURL: function () {} },
    document: { createElement: function () { return { click: function () {} }; } } };
  vm.createContext(sb);
  vm.runInContext(extractFunction(SRC, 'exportDataBackup') + '\nexportDataBackup();', sb);
  return made.length;
}
assertEq(tryExport('student', { id: 'S' }), 0, 'a trainee\'s session produces no file');
assertEq(tryExport(null, null), 0, 'nor does the sign-in page');
assertEq(tryExport('adminstaff', { id: 'AS' }), 0, 'nor Admin Staff');
assertEq(tryExport('admin', null), 0, 'nor an "admin" role with nobody signed in');
assertEq(tryExport('admin', { id: 'A' }), 1, 'a signed-in administrator gets the backup');
assert(/\(e\.ctrlKey \|\| e\.metaKey\) && e\.shiftKey && e\.key === 'E'\) \{\s*e\.preventDefault\(\);\s*try \{ exportDataBackup\(\); \}/.test(SRC),
  'the keyboard shortcut goes through the same guarded function');
assert(/function importDataBackup\(\) \{\s*if\(currentRole !== 'admin' \|\| !currentLoggedInUser\)/.test(SRC), 'restoring is guarded the same way');

/* ---------- 2. Restore: merged, never written over ---------- */
console.log('A restored backup is merged in by the sync rules');
assertEq(R.mergeValue('voctrain_deletedUserIds', '["USR-9"]', ['USR-1']), '["USR-1","USR-9"]', 'deletion lists are unioned');
assertEq(R.mergeValue('voctrain_deletedUserIds', '["USR-1","USR-9"]', ['USR-1']), null, 'a backup holding fewer deletions changes nothing — it never un-deletes');
const nowAcct = [{ id: 'USR-1', password: 'NEW', status: 'disabled', updatedAt: '2026-10-01T00:00:00Z' }];
let out = R.mergeValue('voctrain_users', JSON.stringify(nowAcct), [{ id: 'USR-1', password: 'OLD', status: 'active', updatedAt: '2026-09-01T00:00:00Z' },
  { id: 'USR-2', password: 'P2', status: 'active' }]);
out = JSON.parse(out);
assertEq(out[0].password + '/' + out[0].status, 'NEW/disabled', 'an account edited since the backup keeps its current password and status');
assertEq(out.length, 2, 'an account missing here is added back');
assertEq(R.mergeValue('voctrain_students', '[{"id":"S1","name":"A"}]', []), null, 'an empty list in the file is never written over records');
assertEq(R.mergeValue('voctrain_students', '', [{ id: 'S1' }]), '[{"id":"S1"}]', 'an empty key here takes the backup');
assertEq(R.mergeValue('voctrain_studentProfiles', '{"S1":{"a":1}}', { S1: { a: 0 }, S2: { b: 2 } }), '{"S1":{"a":1},"S2":{"b":2}}', 'a map only gains entries');
assertEq(R.mergeValue('voctrain_systemSettings', '{"x":1}', { x: 2 }), null, 'a setting the device holds stands');
assertEq(R.mergeValue('voctrain_students', '{not json', [{ id: 'S1' }]), null, 'an unreadable stored value is never mistaken for empty');
assertEq(R.restoreOrder(['voctrain_users', 'voctrain_deletedUserIds', 'voctrain_students']).join(','), 'voctrain_deletedUserIds,voctrain_users,voctrain_students',
  'deletion lists are applied first');
const imp = extractFunction(SRC, 'importDataBackup');
assert(/CESTISCore\.backupRestore\.restoreOrder\(Object\.keys\(backup\.data\)\)/.test(imp) && /CESTISCore\.backupRestore\.mergeValue\(k, CESTISStore\.getItem\(k\), backup\.data\[k\]\)/.test(imp),
  'importDataBackup merges each key instead of overwriting it');
assert(imp.indexOf('CESTISStore.setItem(k, JSON.stringify(backup.data[k]))') === -1, 'the wholesale overwrite is gone');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
