/* The sign-in merge notes which version of the shared copy it read, so the
   first autosave of the session merges anything newer instead of skipping it.

   What went wrong (seen in tests/browser/exam-resume.js, two PCs with one
   trainee's test open on both): PC 2 signed in and merged the Main backup at
   version 4. A few seconds later PC 1 uploaded version 5 (a newer answer).
   PC 2's first autosave saw version 5 for the first time and, because "a
   login sync already merged the Main copy", took it as its baseline WITHOUT
   merging it — then uploaded its own copy over it. PC 1's answer vanished
   from the shared copy (and anything else another device wrote in those
   seconds, until that device happened to write again).

   Now silentMergeFromBackup, when it merges the Main backup with no version
   noted yet this session, reads the version first and notes it once the
   merge succeeds; pullMainIfRemoteNewer then compares against it like any
   later tick. Functions are extracted from the real index.html of both builds
   and run against a stubbed Drive.

   Run: node tests/sign-in-merge-version.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const BUILDS = [
  { where: 'online', src: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') },
  { where: 'Offline System', src: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8') }
];
function extractFunction(src, name) {
  const m = new RegExp('(?:^|\\n)(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

// A Drive holding the Main backup (file F in folder FOLD) at `drive.version`;
// every merge is counted.
function device(B, opts) {
  opts = opts || {};
  const drive = { version: '4', metaCalls: 0, downloads: 0, metaFails: !!opts.metaFails };
  const sb = {
    console: { log() {}, warn() {} }, JSON, Date, Math, Object, Array, String, Promise, setTimeout,
    googleAccessToken: 'tok', isCloudConnected: true, cloudFileId: null, _autoSaveFileIds: { FOLD: 'F' }, GOOGLE_DRIVE_CONFIG: { FOLDER_ID: 'FOLD' },
    _mainMergedThisSession: false, _lastCloudVersion: {},
    handleCloudAuthExpired() {}, cestisNoteServerClock() {}, findBackupFileInFolder: async () => 'F',
    merges: [], mergeBackupData: async function (b) { sb.merges.push(b.data.v); return true; }
  };
  sb.fetch = async (u) => {
    if (/fields=version/.test(u)) {
      drive.metaCalls++;
      if (drive.metaFails) return { ok: false, status: 500, json: async () => ({}), headers: { get: () => null } };
      return { ok: true, status: 200, json: async () => ({ version: drive.version }), headers: { get: () => null } };
    }
    drive.downloads++;
    return { ok: true, status: 200, json: async () => ({ version: '1.0', data: { v: drive.version } }), headers: { get: () => null } };
  };
  sb.window = sb;
  vm.createContext(sb);
  const pre = (B.src.match(/var _lastPull = \{[^\n]*\n/) || [''])[0] + 'var _pullFailStreak = 0; var _mergeBackupFailed = false;\n';
  vm.runInContext(pre + ['silentMergeFromBackup', 'pullAllowsUpload', 'pullMainIfRemoteNewer'].map(n => extractFunction(B.src, n)).join('\n'), sb);
  return { sb, drive, run: code => vm.runInContext(code, sb) };
}

(async function main() {
  for (const B of BUILDS) {
    console.log('The sign-in merge notes the version it read; the first autosave merges anything newer (' + B.where + ')');
    {
      const d = device(B);
      await d.run("silentMergeFromBackup('F')");
      assertEq(d.sb.merges.join(), '4', 'the sign-in merge reads version 4');
      assertEq(d.run('_lastCloudVersion.FOLD'), '4', 'and notes it as seen');
      assert(d.run('_mainMergedThisSession') === true, '(and that the Main copy was merged this session)');
      d.drive.version = '5';                                   // PC 1 uploads a newer answer
      await d.run('pullMainIfRemoteNewer()');
      assertEq(d.sb.merges.join(), '4,5', 'the first autosave MERGES version 5 — it used to take it as seen and upload over it');
      assertEq(d.run('_lastCloudVersion.FOLD'), '5', 'and then notes 5');
      await d.run('pullMainIfRemoteNewer()');
      assertEq(d.sb.merges.join(), '4,5', 'nothing new: no second download');
    }
    {
      const d = device(B);
      await d.run("silentMergeFromBackup('F')");
      await d.run('pullMainIfRemoteNewer()');
      assertEq(d.sb.merges.join(), '4', 'when nobody wrote in between, the first autosave downloads nothing more');
    }
    {
      const d = device(B);
      d.sb._autoSaveFileIds = { FOLD: 'F', OTHER: 'G' };
      await d.run("silentMergeFromBackup('G')");
      assertEq(d.drive.metaCalls, 0, 'merging another folder\'s copy asks for no version');
      assertEq(d.run('JSON.stringify(_lastCloudVersion)'), '{}', 'and notes none');
    }
    {
      const d = device(B);
      d.sb._lastCloudVersion = { FOLD: '3' };
      await d.run("silentMergeFromBackup('F')");
      assertEq(d.drive.metaCalls, 0, 'a later merge (a version already noted) asks for no extra version');
      assertEq(d.run('_lastCloudVersion.FOLD'), '3', 'and leaves the noting to the autosave, as before');
    }
    {
      const d = device(B, { metaFails: true });
      await d.run("silentMergeFromBackup('F')");
      assertEq(d.sb.merges.join(), '4', 'if the version cannot be read the merge still happens');
      assertEq(d.run('JSON.stringify(_lastCloudVersion)'), '{}', 'and no version is noted (the autosave decides as it always did)');
    }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
