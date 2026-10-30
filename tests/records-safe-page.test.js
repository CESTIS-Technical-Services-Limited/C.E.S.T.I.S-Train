/* Keeping the records safe for years — the pages' own code, both builds
   (owner approved, group F; the operations audit's OPS-1, OPS-2, OPS-4,
   OPS-10, OPS-11).

   Pinned here, by running index.html's own functions against stand-ins:
     1. the week's backup (cestisWeeklyBackupRun): a copy made where the
        whole-Centre backup is kept — no upload; a week already made (any
        file of its name) — nothing; a copy that cannot be made — this PC's
        own snapshot uploaded, only once it has read the Centre's records;
        a full account — it stops; the tidy-up moves only this system's own
        weekly files to the trash and has no way to delete anything;
     2. the "Backups" folder: beside the backup folders, remembered, the
        oldest of two;
     3. the sync chip's words: "Storage is full — tell the administrator"
        for everybody, what to do for the Administrator; "Press Reconnect";
     4. the sibling pages (cestis-page-cloud.js, cestis-sync-chip.js) say a
        full account the same way;
     5. the pieces are on the pages: the weekly restore, the health card,
        Reconnect, the trainee sign-in card's check buttons; the setup sheet
        has no code to paste; the master restore and the weekly restore share
        one add-only merge.
   In a real browser: tests/browser/records-safe.js, sign-in-renewal.js, gate-checks.js.

   Run: node tests/records-safe-page.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const PAGES = [
  { where: 'index.html', src: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), core: require('../cestis-core.js'), dir: '' },
  { where: 'Offline System/index.html', src: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8'), core: require('../Offline System/cestis-core.js'), dir: 'Offline System' }
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

/* An in-memory stand-in for the few calls the backups make (cestisBackupApi's shape). */
function fakeApi(opts) {
  opts = opts || {};
  const files = opts.files || {};
  const calls = [];
  let seq = 0;
  const now = () => new Date(1793300000000 + (seq++) * 1000).toISOString();
  const err = (status, full) => { const e = new Error('HTTP ' + status); e.status = status; if (full) e.storageFull = true; return e; };
  const api = {
    files, calls,
    list: async q => {
      calls.push('list');
      const m = /'([^']+)' in parents/.exec(q), name = /name = '([^']+)'/.exec(q), ap = /appProperties has \{ key='([^']+)' and value='([^']+)' \}/.exec(q);
      return Object.values(files).filter(f => !f.trashed && (!m || f.parents.indexOf(m[1]) !== -1) && (!name || f.name === name[1]) &&
        (!ap || (f.appProperties && f.appProperties[ap[1]] === ap[2])))
        .sort((a, b) => a.createdTime < b.createdTime ? -1 : 1).map(f => Object.assign({}, f));
    },
    get: async id => { calls.push('get'); const f = files[id]; if (!f) throw err(404); return Object.assign({}, f); },
    copy: async (id, meta) => {
      calls.push('copy');
      if (opts.full) throw err(403, true);
      if (opts.copyBroken) throw err(500);
      const src = files[id]; if (!src) throw err(404);
      const f = Object.assign({ id: 'c' + seq, createdTime: now(), content: src.content }, meta);
      files[f.id] = f; return Object.assign({}, f);
    },
    folder: async meta => { calls.push('folder'); const f = Object.assign({ id: 'F' + seq, createdTime: now() }, meta); files[f.id] = f; return f; },
    upload: async (meta, text) => {
      calls.push('upload');
      if (opts.full) throw err(403, true);
      const f = Object.assign({ id: 'u' + seq, createdTime: now(), content: text }, meta); files[f.id] = f; return f;
    },
    trash: async id => { calls.push('trash'); files[id].trashed = true; return { id, trashed: true }; }
    // No way to delete a file at all: the tidy-up can only move one to the trash.
  };
  return api;
}

(async () => {
for (const page of PAGES) {
  const w = page.where, C = page.core, B = C.backups;
  const names = ['cestisWeeklyBackupRun', 'cestisBackupsFolder', 'cestisWeeklyNoteFrom', 'cestisWeeklyNote', 'cestisOlderFile', 'cestisThisPcRead', 'cestisThisPcWrite', 'cestisBuildMasterSnapshot'];
  const src = names.map(n => extractFunction(page.src, n, w)).join('\n');
  function world(o) {
    o = o || {};
    const ls = {};
    const api = fakeApi(o);
    const MASTER_FOLDER = 'MF';
    api.files.MF = { id: 'MF', name: 'Master Snapshot', parents: ['ROOT'], createdTime: '2025-01-01T00:00:00.000Z', mimeType: 'application/vnd.google-apps.folder' };
    if (!o.noMaster) api.files.M = { id: 'M', name: 'cestis-master-snapshot.json', parents: ['MF'], createdTime: '2025-01-02T00:00:00.000Z', modifiedTime: new Date().toISOString(), content: '{"checksum":"x","store":{}}' };
    const saved = [];
    const ctx = {
      console: { log() {}, warn() {}, error() {} }, JSON, Object, Array, Date, Math, Promise, Error, String, Number, Set,
      CESTISCore: C, window: { CESTISCore: C }, localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
      CESTISStore: { getItem: () => null, setItem() {}, uncounted: {} },
      currentRole: o.role || 'admin', systemSettings: {}, MASTER_SNAPSHOT_CONFIG: { FOLDER_ID: MASTER_FOLDER, FILE_NAME: 'cestis-master-snapshot.json' },
      _mainMergedThisSession: o.merged !== false, _lastAutoSaveResult: { uploaded: false },
      cestisBackupApi: () => api,
      findMasterSnapshotFile: async () => (o.lookupFailed ? 'LOOKUP_FAILED' : (api.files.M ? 'M' : null)),
      saveMasterSnapshot: async () => { saved.push(1); return { ok: true }; },
      saveState: () => { saved.push('settings'); },
      cestisCollectStoreMap: () => ({ voctrain_students: JSON.stringify([{ id: 'S1', name: 'Tameka Richards' }]) }),
      cestisUnionMasterTombstones: () => {}, getCurrentCloudUser: () => ({ username: 'mthompson' }),
      refreshSyncChip() {}, renderSystemHealthCard() {}
    };
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return { ctx, api, ls, saved };
  }
  const label = B.isoWeek(C.sync.now()).label;

  console.log('The week\'s backup (' + w + ')');
  let x = world();
  let r = await x.ctx.cestisWeeklyBackupRun(label);
  const made = Object.values(x.api.files).filter(f => f.name === B.fileName(label));
  assert(r.made && r.how === 'copy' && made.length === 1 && x.api.calls.indexOf('upload') === -1, w + ': copied where it is kept, no upload (' + x.api.calls.join(',') + ')');
  assert(made[0].appProperties.cestisBackup === 'weekly' && made[0].appProperties.cestisWeek === label && made[0].content === x.api.files.M.content, w + ': with the mark; the whole-Centre backup\'s very content');
  const folder = Object.values(x.api.files).find(f => f.name === 'Backups');
  assert(folder && folder.parents[0] === 'ROOT' && made[0].parents[0] === folder.id && folder.appProperties.cestisBackupsFolder === '1', w + ': in "Backups", beside the backup folders');
  assert(x.ctx.systemSettings.backupsFolderId === folder.id && x.saved.indexOf('settings') !== -1, w + ': its folder remembered in the Centre\'s settings (the Administrator\'s PC)');
  assert(JSON.parse(x.ls.cestisThisPc_weeklyBackups).doneWeek === label, w + ': this PC notes the week as done');
  x.api.calls.length = 0;
  r = await x.ctx.cestisWeeklyBackupRun(label);
  assert(!r.made && x.api.calls.indexOf('copy') === -1 && Object.values(x.api.files).filter(f => f.name === B.fileName(label)).length === 1, w + ': a week already made: nothing more');

  x = world({ role: 'adminstaff' });
  x.api.files.own = { id: 'own', name: 'Backups', parents: ['ROOT'], createdTime: '2024-01-05T00:00:00.000Z', mimeType: 'application/vnd.google-apps.folder' };
  x.api.files.hand = { id: 'hand', name: 'Backups', parents: ['ROOT'], createdTime: '2024-05-05T00:00:00.000Z', mimeType: 'application/vnd.google-apps.folder', appProperties: { cestisBackupsFolder: '1' } };
  x.api.files.coll = { id: 'coll', name: B.fileName(label), parents: ['hand'], createdTime: '2026-10-26T08:00:00.000Z' };
  r = await x.ctx.cestisWeeklyBackupRun(label);
  assert(!r.made && x.api.calls.indexOf('copy') === -1, w + ': a file of this week\'s name (no mark even) counts as done — never a second one');
  assert(x.ctx.systemSettings.backupsFolderId === undefined && JSON.parse(x.ls.cestisThisPc_backupsFolder) === 'hand', w + ': an office PC finds this system\'s folder (the settings are the Administrator\'s to publish), not the Centre\'s own "Backups"');
  assert(!Object.values(x.api.files).some(f => f.parents && f.parents[0] === 'own'), w + ': nothing is put in a "Backups" folder this system did not make');

  x = world({ copyBroken: true });
  r = await x.ctx.cestisWeeklyBackupRun(label);
  const up = Object.values(x.api.files).find(f => f.name === B.fileName(label));
  let snap = null; try { snap = JSON.parse(up.content); } catch (e) {}
  assert(r.made && r.how === 'upload' && snap && snap.checksum && snap.counts && snap.store && snap.event === 'weekly-backup', w + ': a copy that cannot be made: the snapshot this PC builds, uploaded');
  x = world({ copyBroken: true, merged: false });
  r = await x.ctx.cestisWeeklyBackupRun(label);
  assert(!r.made && r.why === 'not-merged-yet' && x.api.calls.indexOf('upload') === -1, w + ': ...but never from a PC that has not read the Centre\'s records yet');
  x = world({ lookupFailed: true });
  r = await x.ctx.cestisWeeklyBackupRun(label);
  assert(!r.made && r.why === 'lookup-failed', w + ': the whole-Centre backup could not be looked for: nothing made, tried again later');
  x = world({ full: true });
  let threw = null;
  try { await x.ctx.cestisWeeklyBackupRun(label); } catch (e) { threw = e; }
  assert(threw && threw.storageFull && x.api.calls.indexOf('upload') === -1, w + ': the account is full: it stops (no upload of a whole snapshot into a full account)');

  console.log('The tidy-up: only this system\'s own, to the trash (' + w + ')');
  x = world();
  await x.ctx.cestisWeeklyBackupRun(label);
  const fid = x.ctx.systemSettings.backupsFolderId;
  for (let i = 1; i <= 13; i++) {
    const l = B.isoWeek(C.sync.now() - i * 7 * 86400000).label;
    x.api.files['o' + i] = { id: 'o' + i, name: B.fileName(l), parents: [fid], createdTime: new Date(Date.now() - i * 7 * 86400000).toISOString(), appProperties: { cestisBackup: 'weekly', cestisWeek: l } };
  }
  x.api.files.mine = { id: 'mine', name: B.fileName('2020-W01'), parents: [fid], createdTime: '2020-01-01T00:00:00.000Z' };
  x.api.files.dup = { id: 'dup', name: B.fileName(label), parents: [fid], createdTime: new Date(Date.now() + 5000).toISOString(), appProperties: { cestisBackup: 'weekly' } };
  x.ls.cestisThisPc_weeklyBackups = '{}';
  const nBefore = Object.keys(x.api.files).length;
  await x.ctx.cestisWeeklyBackupRun(label);
  const binned = Object.values(x.api.files).filter(f => f.trashed).map(f => f.id).sort();
  assert(binned.join() === ['dup', 'o12', 'o13'].sort().join(), w + ': the duplicate and the weeks beyond 12 go to the trash: ' + binned.join());
  assert(!x.api.files.mine.trashed, w + ': a file without the mark is never touched');
  assert(Object.keys(x.api.files).length === nBefore, w + ': nothing is deleted (' + nBefore + ' files before and after)');
  const apiSrc = extractFunction(page.src, 'cestisBackupApi', w);
  assert(!/DELETE/.test(apiSrc) && /trashed: true/.test(apiSrc), w + ': the backups\' own calls have no delete at all — only "move to the trash"');

  console.log('What each person is told (' + w + ')');
  const H = s => C.ui.syncHealth(Object.assign({ now: Date.now(), online: true, connected: true, staff: true, canConnect: true, failures: 1, pending: true, pendingSince: Date.now() - 60000 }, s));
  let h = H({ storageFull: true, isAdmin: false });
  assert(h.state === 'storage-full' && h.tone === 'bad' && h.label === 'Storage is full — tell the administrator' && h.chip === 'Storage is full', w + ': office staff and instructors: "' + h.label + '"');
  assert(/kept on this computer/.test(h.detail) && h.advice.some(a => /Tell the administrator/.test(a)), w + ': their work is kept; tell the administrator');
  h = H({ storageFull: true, isAdmin: true });
  assert(h.label === 'Storage is full — make room to keep saving' && h.advice.some(a => /Clear out old class recordings, or empty the trash/.test(a)), w + ': the Administrator is told what to do');
  assert(H({ storageFull: true, online: false }).state === 'offline' && H({ storageFull: true, staff: false, ownPending: false }).state === 'saved', w + ': offline stays offline; a trainee\'s device is never told');
  h = H({ storageFull: false, failures: 0, pending: false, canRenew: true });
  assert(h.advice.some(a => /Press Reconnect/.test(a)) && h.tone === 'warn', w + ': a sign-in that could not renew itself: "Press Reconnect", amber');
  h = C.ui.syncHealth({ now: Date.now(), online: true, connected: false, staff: true, canConnect: true, signinExpired: true, canRenew: true, pending: true });
  assert(h.state === 'attention' && /Press Reconnect/.test(h.advice[0]), w + ': run out: "' + h.advice[0] + '"');
  [H({ storageFull: true }), H({ storageFull: true, isAdmin: true })].forEach(o => assert(!/google|drive|cloud|server/i.test([o.label, o.detail].concat(o.advice).join(' ')), w + ': no place named'));

  console.log('The sibling pages say a full account the same way (' + w + ')');
  {
    const pc = fs.readFileSync(path.join(ROOT, page.dir, 'cestis-page-cloud.js'), 'utf8');
    const apiFn = /function api\(url, opts\) \{[\s\S]*?\n  \}\n/.exec(pc)[0];
    const refusal = JSON.stringify({ error: { code: 403, errors: [{ reason: 'storageQuotaExceeded' }], message: "The user's Drive storage quota has been exceeded." } });
    const sb = { root: { CESTISCore: C, fetch: async () => ({ ok: false, status: 403, text: async () => refusal }) }, out: null };
    vm.createContext(sb);
    vm.runInContext(apiFn + '\nout = api("x", {}).then(function(){ return null; }, function(e){ return e; });', sb);
    const e = await sb.out;
    assert(e && e.message === 'http-403' && e.storageFull === true, w + ': cestis-page-cloud.js marks the refusal as a full account (its message unchanged)');
    sb.root.fetch = async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ error: { code: 403, errors: [{ reason: 'userRateLimitExceeded' }] } }) });
    vm.runInContext('out = api("x", {}).then(function(){ return null; }, function(e){ return e; });', sb);
    const e2 = await sb.out;
    assert(e2 && !e2.storageFull, w + ': a rate limit is not');
    assert(/self\.state\.storageFull = !!\(e && e\.storageFull\)/.test(pc) && /storageFull: !!p\.state\.storageFull/.test(pc), w + ': the page remembers it until a save goes through');
    const chipSrc = fs.readFileSync(path.join(ROOT, page.dir, 'cestis-sync-chip.js'), 'utf8');
    assert(/if \(st\.storageFull\) full = true;/.test(chipSrc) && /storageFull: !lanOn && connected && full/.test(chipSrc), w + ': the sibling pages\' chip reads it');
    assert(/k\.indexOf\('cestisThisPc_'\) === 0\) return true/.test(pc) && /excludePrefixes: \['cestis_pagecloud_stamps__', 'cestisThisPc_'\]/.test(pc), w + ': this computer\'s own notes never travel on the Centre\'s network');
  }

  console.log('The pieces are on the pages (' + w + ')');
  const s = page.src;
  assert(/id="weeklyRestoreItem"[^>]*onclick="closeSyncChipPanel\(\); restoreFromWeeklyBackup\(\)"/.test(s), w + ': "Restore from a Weekly Backup" in the sync menu');
  assert(/id="syncChipBackupLine"/.test(s) && /id="syncChipBackupPrompt"/.test(s) && /id="syncChipStorageLine"/.test(s), w + ': the Administrator\'s last-backup and storage lines in the sync panel');
  assert(/<div id="systemHealthCard" class="sys-health-mount"><\/div>/.test(s) && /renderSystemHealthCard\(\);/.test(extractFunction(s, 'buildAdminPages', w)), w + ': the System health card has its own block on the dashboard');
  assert(/id="syncReconnectBtn" hidden onclick="cestisReconnectFromClick\(\)"/.test(s), w + ': Reconnect beside the sync control');
  const restoreMaster = extractFunction(s, 'restoreFromMasterBackup', w), apply = extractFunction(s, 'cestisApplySnapshotRestore', w);
  assert(/cestisApplySnapshotRestore\(snapshot\)/.test(restoreMaster) && /CESTISCore\.reconcileSnapshot\(snapshot, local\)/.test(apply), w + ': the master restore and the weekly restore share one add-only merge');
  const preview = extractFunction(s, 'cestisWeeklyRestorePreview', w);
  assert(/reconcileSnapshot\(snap, cestisCollectStoreMap\(\)\);\s*\/\/ nothing is written/.test(preview) && !/setItem/.test(preview), w + ': the preview writes nothing');
  const auto = extractFunction(s, 'autoSaveToAllFolders', w);
  assert(/reason: 'storage-full'/.test(auto) && /STORAGE_FULL_RETRY_MS/.test(auto), w + ': a full account: the backup is resent every 2 minutes, not every 5 seconds');
  assert(/delete backupData\.data\.deviceSaves;\s*const _dataStr/.test(auto), w + ': each computer\'s last-save note does not make a save "changed"');
  assert(/cestisWeeklyBackupTick\(\)/.test(auto), w + ': the week\'s backup is looked after beside the 5-second save');
  assert(/var GATE_EXPECTED_VERSION = 3;/.test(s), w + ': the trainee sign-in program stays version 3');
}

console.log('The trainee sign-in card and its setup sheet');
const admin = fs.readFileSync(path.join(ROOT, 'Pages', 'Administration.html'), 'utf8');
['reach', 'large', 'email', 'search', 'page'].forEach(k => assert(admin.indexOf("onclick=\"gateLiveCheck('" + k + "')\"") !== -1, 'the card has the "' + k + '" check button'));
assert(fs.readFileSync(path.join(ROOT, 'Offline System', 'Pages', 'Administration.html'), 'utf8') === admin, 'and the Offline System has the same card');
const setup = fs.readFileSync(path.join(ROOT, 'trainee-gate', 'SETUP.md'), 'utf8');
const sec3 = setup.slice(setup.indexOf('## 3. Live checks'), setup.indexOf('## 4.'));
assert(!/F12|console|```js/.test(sec3), 'the setup sheet\'s live checks paste no code into the browser');
['This page can reach it', 'A large file arrives whole', 'Email sign-in is accepted', 'Files are found by name', 'Open the full check page'].forEach(b => assert(sec3.indexOf('**' + b + '**') !== -1, 'the setup sheet says to press "' + b + '"'));
const gs = fs.readFileSync(path.join(ROOT, 'trainee-gate', 'Gate.gs'), 'utf8');
assert(/var GATE_VERSION = 3;/.test(gs) && /'diag\.echo': gateDiagEcho, 'diag\.tokeninfo': gateDiagTokenInfo/.test(gs), 'the gate itself is unchanged: version 3, its own diag checks');

console.log('Running the Centre: one plain page (OPS-3, OPS-13)');
const run = fs.readFileSync(path.join(ROOT, 'docs', 'RUNNING-THE-CENTRE.md'), 'utf8');
['## Every day', '## Every week', '## Every month', '## Every term', '## Every year', '## When something goes wrong', '## Who owns what'].forEach(h =>
  assert(run.indexOf(h) !== -1, 'RUNNING-THE-CENTRE.md has "' + h + '"'));
['office computer signed in', 'System health', 'USB stick', 'class recordings', 'Academic Year', 'cert-keys.json', 'payroll rates', 'EmailJS', 'TURN',
 'lost, stolen or broken', 'Google account is lost', 'folder was deleted', 'Trash', 'within 30 days', 'Restore from a Weekly Backup', 'Trainee sign-in stops working',
 'Two people', '2-Step Verification', 'recovery phone', '"In production", not "Testing"'].forEach(w =>
  assert(run.indexOf(w) !== -1, 'it covers "' + w + '"'));
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
assert(/\[`docs\/RUNNING-THE-CENTRE\.md`\]\(docs\/RUNNING-THE-CENTRE\.md\)/.test(readme.slice(0, 600)), 'README points to it first');
assert(/Setting up MegaData \(operator checklist\) — NOT IN USE/.test(readme) && !/126 Node suites/.test(readme), 'README: the broker checklist marked "not in use"; the old counts gone');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
