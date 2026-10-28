/* Restoring a backup on a new PC fills the empty shells a page wrote there.

   What happened (found by tests/browser/upgrade-no-data-loss.js, "Import
   Backup on a brand-new device"): a Centre restores its Export Backup on a
   new PC. The administrator signs in first — they have to, only an
   administrator may import — and during appraisal season that sign-in
   (sappOnAdminLogin in staff-appraisals.js) writes the appraisal store's
   start-up shell: { cycles: {}, assignments: {}, extraStaff: [], flags: {…} }.
   The import merges each key without writing over anything
   (CESTISCore.backupRestore.mergeKey), and for an object it only added the
   parts this device did not have at all. "cycles" was there — empty — so the
   Centre's five appraisals were "kept as they are on this device", which was
   nothing, and the restore left every staff appraisal out.

   Pinned here, with the real cestis-core.js and the real importDataBackup()
   from index.html:
     - an empty list or object on this device is filled from the backup;
     - anything this device holds that is not empty still stands (and is
       named as kept), so a newer edit here is never written over;
     - a blank text field is not refilled (unchanged: a person may have
       cleared it on purpose);
     - the dashboard's Import Backup restores the appraisals over the shell.

   Run: node tests/backup-import-shell.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function extractFunction(src, name) {
  const m = new RegExp('function ' + name + '\\(').exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

// The shell the administrator's first sign-in writes on a new PC (as the
// browser test read it back), and the Centre's appraisals in its backup.
const SHELL = { cycles: {}, assignments: {}, extraStaff: [], flags: { 'notified_open_2025-2026': true } };
const appraisal = (sid, name) => ({ cycle: '2026-2027', staffId: sid, staffName: name, template: 'instructor',
  scores: { s2: [4, 4, 3] }, updatedAt: '2026-09-01T10:00:00.000Z' });
const CENTRE = {
  cycles: { '2026-2027': { 'USR:I1': appraisal('USR:I1', 'Garfield Myers'), 'USR:I2': appraisal('USR:I2', 'Marcia Grant') } },
  assignments: { 'USR:I1': 'USR-001' },
  extraStaff: [{ id: 'X1', name: 'Paul Reid (contract)' }],
  flags: { 'notified_open_2026-2027': true }
};
const KEY = 'cestisStaffAppraisals';
const BR = Core.backupRestore;

console.log('An empty list or object on this device is a blank the backup fills');
let r = BR.mergeKey(KEY, JSON.stringify(SHELL), CENTRE, { read: () => null });
const got = r.value ? JSON.parse(r.value) : null;
assert(!!got, 'the merge writes the appraisals (it returned nothing)');
assertEq(got && Object.keys(got.cycles['2026-2027'] || {}).length, 2, 'both appraisals are restored');
assertEq(got && got.assignments['USR:I1'], 'USR-001', 'the appraiser assignments are restored');
assertEq(got && got.extraStaff.length, 1, 'the contract staff are restored');
assertEq(got && got.flags['notified_open_2025-2026'], true, 'this device\'s own flags stay');
assert(r.kept, 'the flags that differ are named as kept, not merged silently');

console.log('What this device holds that is not empty still stands');
const mine = JSON.parse(JSON.stringify(CENTRE));
mine.cycles['2026-2027']['USR:I1'].scores = { s2: [5, 5, 5] };
mine.cycles['2026-2027']['USR:I1'].updatedAt = '2026-10-20T10:00:00.000Z';
r = BR.mergeKey(KEY, JSON.stringify(mine), CENTRE, { read: () => null });
assertEq(r.value, null, 'a device that already holds appraisals is not written over');
assert(r.kept, 'and the difference is named as kept');
r = BR.mergeKey('voctrain_systemSettings', JSON.stringify({ notice: '', institutionName: 'C.E.S.T.I.S' }),
  { notice: 'Closed on Friday', institutionName: 'C.E.S.T.I.S' }, { read: () => null });
assertEq(r.value, null, 'a blank text field is not refilled (it may have been cleared on purpose)');
r = BR.mergeKey(KEY, null, CENTRE, { read: () => null });
assertEq(r.value && JSON.parse(r.value).extraStaff.length, 1, 'a key this device does not hold is taken whole, as before');

console.log('The dashboard\'s Import Backup restores the appraisals over the shell');
const mem = new Map([[KEY, JSON.stringify(SHELL)]]);
const toasts = [];
let reloaded = false;
const backupText = JSON.stringify({ version: 2, exportedAt: '2026-10-21T12:00:00.000Z', data: { [KEY]: CENTRE } });
const sandbox = {
  currentRole: 'admin', currentLoggedInUser: { id: 'USR-001' },
  CESTISCore: Core,
  CESTISStore: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) },
  showToast: m => toasts.push(m),
  _originalConfirm: () => true,
  stopAutoSave: () => {}, _debouncedCloudSaveTimer: null, _sessionWiped: false,
  console: { warn: () => {}, log: () => {}, error: () => {} },
  location: { reload: () => { reloaded = true; } },
  setTimeout: fn => fn(), clearTimeout: () => {},
  FileReader: function () { this.readAsText = () => this.onload({ target: { result: backupText } }); },
  document: { createElement: () => ({ click() { this.onchange({ target: { files: [{ name: 'backup.json' }] } }); } }) }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(extractFunction(INDEX, 'importDataBackup') + '\nimportDataBackup();', sandbox);
const after = JSON.parse(mem.get(KEY) || '{}');
assertEq(Object.keys((after.cycles || {})['2026-2027'] || {}).length, 2, 'every appraisal is on the new PC after the import');
assertEq((after.extraStaff || []).length, 1, 'and the contract staff');
assert(reloaded, 'the page reloads after the merge, as before');

console.log('Summary: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
