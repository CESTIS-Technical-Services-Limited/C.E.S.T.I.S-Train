/* The Cashbook's 15-second sync downloads its file only when it changed, and
   an edit made during an upload still goes up.

   What went wrong (EF-8 in the efficiency audit): autoMergeAndSave downloaded
   the whole Cashbook file on every 15-second tick before any check — 240
   downloads an hour for every open Cashbook tab. And its "nothing written
   since" mark was taken after the upload had finished, which counted an edit
   made while the upload was on its way as already sent.

   Pinned here by running the page's own autoMergeAndSave (both builds)
   against a stand-in Drive:
     - unchanged file: a version check only, no download;
     - another device writes: downloaded once and merged;
     - this page's own upload is not downloaded back;
     - an edit made during the upload goes up on the next tick;
     - a Drive that will not describe the file: downloaded as before.

   Run: node tests/cashbook-idle-sync.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const ROOT = path.join(__dirname, '..');
const PAGES = [path.join(ROOT, 'CESTIS.Cashbook.html'), path.join(ROOT, 'Offline System', 'CESTIS.Cashbook.html')];
function extractFunction(src, name) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('no ' + name);
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced');
}

(async () => {
for (const file of PAGES) {
  const w = path.relative(ROOT, file);
  const src = fs.readFileSync(file, 'utf8');
  const fn = extractFunction(src, 'autoMergeAndSave');
  console.log('The 15-second sync (' + w + ')');
  const drive = { version: 5, content: JSON.stringify({ version: '1', data: { tx: ['T1'] } }), downloads: 0, metas: 0, patches: [], noMeta: false, hold: null };
  const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return resp(status, body); } });
  const store = { writes: 0, data: {}, getItem: k => (k in store.data ? store.data[k] : null), setItem(k, v) { store.writes++; store.data[k] = String(v); } };
  const merged = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, JSON, Date, Math, Promise, Blob, Error, Number, String, FormData: function () { this.append = () => {}; },
    window: {}, navigator: { onLine: true }, CESTISStore: store,
    isCloudConnected: true, googleAccessToken: 'tok', cloudSyncing: false, cloudFileId: 'CB', lastSyncTime: null, lastSavedBy: '', cloudFileTimestamp: '', currentUser: { fullName: 'Clerk' },
    GOOGLE_DRIVE_CONFIG: { BACKUP_FILE_NAME: 'CESTIS_CASHBOOK_DASHBOARD_BACKUP.json', FOLDER_ID: 'F' },
    setCloudSyncing() {}, updateLastSyncDisplay() {}, updateLastSavedByDisplay() {}, updateCloudUI() {}, showCloudNotification() {}, findExistingBackupFile: async () => {},
    silentMerge: d => { merged.push(d.data); },
    prepareBackupData: () => ({ version: '1', data: { tx: ctx.__tx.slice() } }),
    __tx: ['T1'],
    fetch: async (url, opts) => {
      if (opts && opts.method === 'PATCH') {
        const body = await opts.body.text();
        if (drive.hold) await drive.hold;
        drive.version++; drive.content = body; drive.patches.push(JSON.parse(body));
        return resp(200, { id: 'CB', version: String(drive.version) });
      }
      if (/\?alt=media/.test(url)) { drive.downloads++; return resp(200, JSON.parse(drive.content)); }
      if (/fields=version/.test(url)) { drive.metas++; return drive.noMeta ? resp(500, {}) : resp(200, { version: String(drive.version), modifiedTime: 't' }); }
      return resp(404, {});
    }
  };
  ctx.window.CESTISStore = store;
  vm.createContext(ctx);
  vm.runInContext(fn + '\nvar _cashbookLastPushWrites = -1, _cashbookSeenVersion = null;', ctx);
  const edit = t => { ctx.__tx.push(t); store.setItem('cashbook_tx', JSON.stringify(ctx.__tx)); };

  await ctx.autoMergeAndSave();
  assertEq(drive.downloads, 1, w + ': the first tick downloads the file');
  assertEq(drive.patches.length, 1, w + ': (and sends this page\'s copy)');
  const d0 = drive.downloads;
  for (let i = 0; i < 8; i++) await ctx.autoMergeAndSave();
  assertEq(drive.downloads - d0, 0, w + ': eight idle ticks: no download (it used to be eight)');
  assert(drive.metas >= 8, w + ': only a version check each tick');
  assertEq(drive.patches.length, 1, w + ': and nothing sent');
  // Another device writes.
  drive.version++; drive.content = JSON.stringify({ version: '1', data: { tx: ['T1', 'OTHER'] } });
  await ctx.autoMergeAndSave();
  assertEq(drive.downloads - d0, 1, w + ': another device\'s write: downloaded once');
  assertEq(merged[merged.length - 1].tx, ['T1', 'OTHER'], w + ': and merged');
  await ctx.autoMergeAndSave();
  assertEq(drive.downloads - d0, 1, w + ': not again');
  // An edit, then an edit made while its upload is on the way.
  edit('T2');
  let release; drive.hold = new Promise(r => { release = r; });
  const tick = ctx.autoMergeAndSave();
  await new Promise(r => setTimeout(r, 5));
  edit('T3');
  drive.hold = null; release(); await tick;
  assert(drive.patches[drive.patches.length - 1].data.tx.indexOf('T3') === -1, w + ': the upload in flight carried T2 only');
  const dl = drive.downloads;
  await ctx.autoMergeAndSave();
  assert(drive.patches[drive.patches.length - 1].data.tx.indexOf('T3') !== -1, w + ': T3, made during that upload, goes up on the next tick');
  assertEq(drive.downloads, dl, w + ': this page\'s own uploads are not downloaded back');
  const n = drive.patches.length;
  for (let i = 0; i < 3; i++) await ctx.autoMergeAndSave();
  assertEq(drive.patches.length, n, w + ': then quiet');
  // A Drive that will not describe the file.
  drive.noMeta = true;
  const d2 = drive.downloads;
  await ctx.autoMergeAndSave();
  assertEq(drive.downloads - d2, 1, w + ': no version to compare: downloaded as before');
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
})();
