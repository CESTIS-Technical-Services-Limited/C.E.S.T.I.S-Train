/* The pre-login Cloud sync: what it actually has to fetch.

   Reported: "The login page syncing taking a long time to sync data, this should
   not be, it took seconds before not minutes."

   Nobody can log in until this finishes, and it was doing five times the work it
   needed to:

     • The autosave writes ONE blob to all five Drive folders — see the
       Promise.allSettled over ALL_DRIVE_FOLDERS in the save path — so on a normal
       login all five hold byte-identical backups.
     • The read path then walked those five folders ONE AT A TIME: look up the
       file, download the whole dataset, merge it, next folder. Ten sequential
       Drive round trips and five full-dataset transfers before the password box
       unlocked, and four of the five merges could not change anything.
     • Nothing compared the file to what this device had already merged, so an
       unchanged backup was downloaded again in full on every login.
     • And there was no AbortController anywhere in the page, so one request that
       never answered blocked its await indefinitely — the gate simply stopped on
       "Syncing from Class Recording (4/5)…" with the buttons still locked.

   Now: the five lookups go out together, identical content is recognised by its
   checksum and fetched once, content already merged is skipped while the device
   still holds data, and every request has a deadline.

   Run: node tests/login-sync-speed.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* Both builds are checked: the offline bundle carries its own copy of this page
   and it is what the Centre runs on site. Pass a path to check just one. */
const PAGES = process.argv[2]
  ? [process.argv[2]]
  : [path.join(__dirname, '..', 'index.html'),
     path.join(__dirname, '..', 'Offline System', 'index.html')];
let SRC = '', PAGE = '';

function extractFunction(name) {
  let at = SRC.indexOf('async function ' + name + '(');
  if (at < 0) at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error(PAGE + ' no longer defines ' + name);
  let depth = 0, i = SRC.indexOf('{', at);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(at, i + 1);
}

// The Step 2 block out of loginPageSync — the part that reads the folders.
function extractStep2() {
  const lp = extractFunction('loginPageSync');
  const from = lp.indexOf('/* Step 2');
  const to = lp.indexOf('// Step 3');
  if (from < 0 || to < 0 || to < from) throw new Error(PAGE + ': cannot locate the folder-read block');
  return lp.slice(from, to);
}

const HELPERS = ['findBackupMetaInFolder', 'loginSyncMergedFingerprints',
  'rememberMergedFingerprint', 'loginSyncMaySkipKnown'];

const FOLDERS = ['Main Backup', 'Online Exams', 'LMS Chat', 'Class Recording', 'Assignments']
  .map((label, i) => ({ id: 'folder' + i, label: label }));

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* One sync run. `store` is carried between runs on purpose — it stands for one
   browser profile across several logins.
   opts.md5      — the checksum every folder's backup reports (identical bytes)
   opts.perFolder— or a checksum per folder, when they genuinely differ
   opts.hasLocal — does this device already hold data?
   opts.failFor  — folder ids whose lookup fails
   opts.absentFor— folder ids that hold no backup at all */
function syncRun(store, opts) {
  opts = opts || {};
  const stats = { lookups: 0, downloads: 0, merged: [] };
  const box = {
    ALL_DRIVE_FOLDERS: FOLDERS,
    _autoSaveFileIds: {},
    googleAccessToken: 'token',
    GOOGLE_DRIVE_CONFIG: { BACKUP_FILE_NAME: 'CESTIS_LMS_BACKUP.json' },
    LOGIN_SYNC_MERGED_KEY: 'schoolDashboardMergedBackupFingerprints',
    DRIVE_REQUEST_TIMEOUT_MS: 20000,
    students: opts.hasLocal ? [{ id: 'S1', name: 'One' }] : [],
    userAccounts: opts.hasLocal ? [{ id: 'U1', username: 'one' }] : [],
    CESTISStore: {
      getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    updateLoginSyncStatus() {},
    console: { log() {}, warn() {}, error() {} },
    // Stands in for the Drive metadata query.
    async driveFetch(url) {
      stats.lookups++;
      const which = FOLDERS.find(f => url.indexOf(f.id) !== -1);
      const id = which ? which.id : 'folder0';
      if ((opts.failFor || []).indexOf(id) !== -1) throw new Error('Drive request timed out after 20s');
      await sleep(1);
      if ((opts.absentFor || []).indexOf(id) !== -1) return { ok: true, json: async () => ({ files: [] }) };
      const md5 = (opts.perFolder && opts.perFolder[id]) || opts.md5 || 'md5-A';
      return { ok: true, json: async () => ({ files: [{ id: 'file-' + md5, md5Checksum: md5,
        modifiedTime: '2026-08-04T00:00:00Z', size: '4200000' }] }) };
    },
    async silentMergeFromBackup(fileId) {
      stats.downloads++;
      stats.merged.push(fileId);
      await sleep(1);
      if (opts.mergeThrows) throw new Error('merge blew up');
      return true;
    },
    Promise, Date, JSON, Object, Array, String, Number, Math,
    setTimeout, clearTimeout, parseInt, parseFloat, isNaN,
    AbortController: typeof AbortController !== 'undefined' ? AbortController : undefined
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(HELPERS.map(extractFunction).join('\n\n'), box);
  return vm.runInContext(
    '(async () => { var isAdmin = true, totalMerged = 0, foldersSynced = 0;\n' +
    extractStep2() + '\nreturn { totalMerged: totalMerged, foldersSynced: foldersSynced }; })()', box
  ).then(r => Object.assign(r, stats));
}

async function runFor(pageFile) {
  SRC = fs.readFileSync(pageFile, 'utf8');
  PAGE = path.relative(path.join(__dirname, '..'), pageFile);
  console.log('\n=== ' + PAGE + ' ===');

  /* ---------- 1. Five folders, one download ---------- */
  console.log('Five folders holding the same backup are downloaded once, not five times');
  let r = await syncRun({}, { hasLocal: false });
  assertEq(r.downloads, 1,
    'the whole dataset is transferred ONCE — five identical copies were being ' +
    'downloaded and fully merged, four of them provably no-ops');
  assertEq(r.foldersSynced, FOLDERS.length, 'and all five folders are still accounted for');
  assertEq(r.lookups, FOLDERS.length, 'one metadata lookup per folder, no more');

  console.log('The five lookups go out together rather than one after another');
  const step2 = extractStep2();
  assert(/Promise\.all\(/.test(step2),
    'the lookups are issued in parallel — ten sequential round trips is what made ' +
    'the gate take minutes');
  assert(!/for\s*\([^)]*ALL_DRIVE_FOLDERS\.length[^)]*\)\s*\{[\s\S]{0,400}await\s+findBackup/.test(step2),
    'and no folder loop still awaits a lookup one folder at a time');

  console.log('Folders holding genuinely different backups are each merged');
  r = await syncRun({}, { hasLocal: false, perFolder: { folder0: 'md5-A', folder1: 'md5-A',
    folder2: 'md5-B', folder3: 'md5-A', folder4: 'md5-C' } });
  assertEq(r.downloads, 3, 'three distinct backups, three downloads — nothing is lost to the dedupe');
  assertEq(new Set(r.merged).size, 3, 'and each is merged exactly once');

  /* ---------- 2. Repeat logins ---------- */
  console.log('\nA repeat login against an unchanged backup downloads nothing');
  const profile = {};
  r = await syncRun(profile, { hasLocal: false });
  assertEq(r.downloads, 1, 'the first login on this device fetches it');
  r = await syncRun(profile, { hasLocal: true });
  assertEq(r.downloads, 0, 'the second finds nothing has changed and fetches nothing at all');
  assertEq(r.foldersSynced, FOLDERS.length, 'while still reporting every folder as checked');

  console.log('A backup that HAS changed is fetched again');
  r = await syncRun(profile, { hasLocal: true, md5: 'md5-CHANGED' });
  assertEq(r.downloads, 1, 'a new checksum is new data');
  r = await syncRun(profile, { hasLocal: true, md5: 'md5-CHANGED' });
  assertEq(r.downloads, 0, 'and then it is known too');

  console.log('A device with no data never skips, however familiar the file looks');
  r = await syncRun(profile, { hasLocal: false, md5: 'md5-CHANGED' });
  assertEq(r.downloads, 1,
    'a cleared store must download — skipping there would log the user in to nothing');

  console.log('A merge that failed is not remembered as done');
  const p2 = {};
  r = await syncRun(p2, { hasLocal: false, mergeThrows: true });
  assertEq(r.downloads, 1, 'it was attempted');
  r = await syncRun(p2, { hasLocal: true });
  assertEq(r.downloads, 1, 'and attempted again next login, rather than skipped forever');

  /* ---------- 3. One bad folder cannot hold the gate ---------- */
  console.log('\nA folder that fails or holds nothing does not stop the others');
  r = await syncRun({}, { hasLocal: false, failFor: ['folder3'] });
  assertEq(r.downloads, 1, 'the backup still merges when one folder\'s lookup fails');
  assert(r.foldersSynced < FOLDERS.length, 'and the failed folder is not counted as synced');

  r = await syncRun({}, { hasLocal: false, absentFor: ['folder1', 'folder3', 'folder4'] });
  assertEq(r.downloads, 1, 'folders holding no backup are simply passed over');

  console.log('Every folder failing is answered, not thrown');
  r = await syncRun({}, { hasLocal: false, failFor: FOLDERS.map(f => f.id) });
  assertEq(r.downloads, 0, 'nothing is merged');
  assertEq(r.foldersSynced, 0, 'and nothing is claimed');

  /* ---------- 4. Requests have a deadline ---------- */
  console.log('\nEvery Cloud request on the login path has a deadline');
  assert(/function driveFetch\(/.test(SRC), 'there is one wrapper that applies it');
  assert(/new AbortController\(\)/.test(SRC),
    'and it really aborts — there was no AbortController anywhere in this page, so a ' +
    'request that never answered left the login gate stuck with the buttons locked');

  const df = extractFunction('driveFetch');
  assert(/\|\|\s*20000/.test(df),
    'the timeout has a literal fallback — a zero-length deadline would abort every ' +
    'request the instant it was made');
  assert(/clearTimeout/.test(df), 'and the timer is always cleared');

  ['silentMergeFromBackup', 'findBackupMetaInFolder', 'findBackupFileInFolder',
   'lmsChatSyncFromDrive', 'syncStudentsFromFeeSystem'].forEach(function (name) {
    let body;
    try { body = extractFunction(name); } catch (e) { return; }   // not in this build
    if (body.indexOf('fetch(') === -1) return;
    assert(body.indexOf('await fetch(') === -1,
      name + ' goes through driveFetch, so it cannot hang the login gate');
  });

  console.log('A failed lookup is never mistaken for a missing backup');
  // This is the invariant that stops the backup forking: 'LOOKUP_FAILED' means
  // "could not tell", null means "confirmed absent, safe to create one".
  const meta = extractFunction('findBackupMetaInFolder');
  assert(/return\s+null;\s*\/\/\s*confirmed absent/.test(meta) || /return null;/.test(meta),
    'null is returned only when the folder answered');
  assert(/LOOKUP_FAILED/.test(meta), 'and a failure says so instead');
  const lastReturn = meta.slice(meta.lastIndexOf('return'));
  assert(/LOOKUP_FAILED/.test(lastReturn),
    'the fall-through after an error is LOOKUP_FAILED, not null — treating a network ' +
    'failure as "no backup here" is what creates a second backup file that then forks');
}

(async () => {
  for (const p of PAGES) await runFor(p);
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAILED: ' + (e && e.message)); process.exit(1); });
