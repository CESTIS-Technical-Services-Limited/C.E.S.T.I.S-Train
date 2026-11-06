/* Two PCs saving in the same moment: the write that was overtaken is
   recovered from the shared copy's revisions — in the stand-in for Drive the
   browser suites share (tests/browser/fake-drive.js) as on the real one.

   Why: the browser suite tests/browser/exam-resume.js, section 5c, failed
   under load. PC 2's 5-second save landed on top of PC 1's save of a newer
   answer (Drive's version jumped by two). The page then reads the file's
   revisions to take in the write it overtook (recoverOvertakenWrite) — but
   the stand-in did not answer revisions requests (400 "not emulated"), so
   PC 2 never saw PC 1's answer until PC 1's next save, submitted the older
   one, and the extra copies were written as "urgent" without the result.
   Real Drive lists and serves revisions, so production recovers; the test
   world now does too.

   This runs the page's own recoverOvertakenWrite (index.html) against the
   stand-in: the revision it fetches is the overtaken write, and it is
   merged. Run: node tests/fake-drive-revisions.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { FakeDrive } = require('./browser/fake-drive');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

function extractFunction(src, name) {
  const at = src.indexOf('async function ' + name + '(');
  if (at === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(name + ' not closed');
}

// fetch, as the page calls it, answered by the stand-in.
function fetchVia(drive) {
  return (url, init) => new Promise((resolve, reject) => {
    const req = { url: () => url, method: () => (init && init.method) || 'GET', postDataBuffer: () => null, allHeaders: async () => (init && init.headers) || {} };
    drive.handle({ request: () => req, fulfill: o => {
      const body = Buffer.isBuffer(o.body) ? o.body.toString('utf8') : String(o.body || '');
      resolve({ ok: (o.status || 200) < 300, status: o.status || 200, json: async () => JSON.parse(body), text: async () => body });
    } }).catch(reject);
  });
}

(async function main() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const fn = extractFunction(src, 'recoverOvertakenWrite');

  console.log('Two PCs save at once: the overtaken write is recovered from the revisions');
  const drive = new FakeDrive();
  const backup = answer => JSON.stringify({ version: '1.0', data: { examAttempts: [{ id: 'ATT-1', status: 'open', answers: [answer] }] } });
  const f = drive.put(null, { name: 'CESTIS_LMS_BACKUP.json', parents: ['main'] }, backup('15'));   // v1, both PCs pulled it
  drive.put(f.id, null, backup('20'));                                                          // v2: PC 1's newer answer
  drive.put(f.id, null, backup('15'));                                                          // v3: PC 2's write lands on top
  assert(f.version === 3 && (f.revisions || []).length === 2, 'the stand-in keeps the replaced contents as revisions (' + (f.revisions || []).length + ')');
  assert(Object.keys(f.revisions[0]).indexOf('bytes') === -1, 'a revision lists as before (its bytes are not one of its listed fields)');

  const merged = [];
  const sandbox = {
    fetch: fetchVia(drive), googleAccessToken: 'tok', console: { warn() {}, log() {} },
    _lastAutoSaveHash: 'h', _copiesUrgent: false,
    mergeBackupData: async d => { merged.push(d); return true; }
  };
  vm.createContext(sandbox);
  vm.runInContext(fn + '\nthis.recoverOvertakenWrite = recoverOvertakenWrite;', sandbox);
  const ok = await sandbox.recoverOvertakenWrite(f.id, '1', '3');
  assert(ok === true, 'PC 2 recovers the write it overtook (' + ok + ')');
  assert(merged.length === 1 && merged[0].data.examAttempts[0].answers[0] === '20', 'it is PC 1\'s write, with the newer answer (' + JSON.stringify(merged.map(m => m.data.examAttempts[0].answers[0])) + ')');
  assert(sandbox._lastAutoSaveHash === null, 'and the union is queued for PC 2\'s next save');
  assert(sandbox._copiesUrgent === false, 'nothing was lost, so the extra copies are not written as "urgent"');
  assert(drive.errors.length === 0, 'every request was one the stand-in answers (' + drive.errors.join('; ') + ')');

  console.log('Only the last few revisions keep their bytes');
  for (let k = 0; k < 40; k++) drive.put(f.id, null, backup(String(k)));
  const kept = f.revisions.filter(r => r.bytes).length;
  assert(kept > 0 && kept <= 30, 'bytes kept for the last revisions only (' + kept + ' of ' + f.revisions.length + ')');
  const old = await sandbox.fetch('https://www.googleapis.com/drive/v3/files/' + f.id + '/revisions/1?alt=media', {});
  assert(old.status === 404, 'an old revision whose bytes are gone answers 404, as a purged one does');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
