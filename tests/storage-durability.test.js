/* Records must not quietly revert once a device's storage fills up.

   What happened: the shared store keeps three copies of every value — an
   in-memory cache, localStorage (a fast seed that survives a reload) and
   IndexedDB (the durable one). getItem() read localStorage FIRST and returned
   any non-null answer it found. setItem() wrapped the localStorage write in a
   try/catch that did nothing.

   Those two together are the fault. When localStorage is full its write throws
   and the PREVIOUS value is left in place, untouched — a failed write does not
   clear the old entry. IndexedDB and the cache took the new value, localStorage
   kept the old one, and because the read trusted localStorage, every read from
   that moment returned the stale copy. The page then saved that stale copy back
   over the good data and uploaded it to Google Drive, carrying the loss to
   every other device. No error, no warning, nothing in the console.

   It gets likelier every year, because the store only grows.

   The fix is one line of intent: a failed localStorage write removes the stale
   entry, so the read falls through to the cache and IndexedDB, which both hold
   what was actually written. The failure is also reported now, instead of being
   swallowed.

   Pinned here:
     - every file carrying a copy of the store has both halves of the fix;
     - the reported-failure path is wired up in each of them;
     - the four collections that used to be written raw now go through the same
       anti-blanking guard as every other collection, in both builds;
     - the offline build declares the autosave counter it uses (it was used and
       declared nowhere, so the cloud backup threw on its first run and silently
       never happened).

   The live proof — writing while localStorage refuses, then reading back — runs
   in a real browser in tests/browser/, because it needs a real localStorage and
   a real IndexedDB. This suite pins the shape in every file that carries it.

   Run: node tests/storage-durability.test.js */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const ROOT = path.join(__dirname, '..');

function walk(dir, acc) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f), rel = path.relative(ROOT, full);
    if (/^(\.git|node_modules)(\/|$)/.test(rel) || /vendor\//.test(rel + '/')) continue;
    if (fs.statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(html|js)$/.test(f)) acc.push(rel);
  }
  return acc;
}

/* Every file that carries a copy of the read-through store. */
const READ_THROUGH = /if\s*\(LS\)\s*\{\s*try\s*\{\s*var lv = LS\.getItem\(k\);/;
const carriers = walk(ROOT, []).filter(f => {
  if (/(^|\/)tests\//.test(f)) return false;
  return READ_THROUGH.test(fs.readFileSync(path.join(ROOT, f), 'utf8'));
});

console.log('Every copy of the store drops a stale entry when the write is refused');
assert(carriers.length >= 16,
  'the store is carried by at least 16 files (found ' + carriers.length + ') — if this drops, a copy was missed');

carriers.forEach(f => {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');

  // The empty catch that swallowed a full-storage write must be gone from setItem.
  assert(!/LS\.setItem\(k\s*,\s*v\);\s*\}\s*catch\s*\(e\)\s*\{\s*\}/.test(src),
    f + ': a refused localStorage write is no longer swallowed in silence');

  // ...and the stale entry must be removed when it is refused.
  assert(/catch\s*\(\s*e\s*\)\s*\{\s*try\s*\{\s*if\s*\(\s*LS\s*\)\s*LS\.removeItem\(k\)/.test(src),
    f + ': a refused write removes the stale localStorage entry, so the read cannot return it');

  // The failure is reported rather than lost.
  assert(/reportWriteFailure\(k,\s*e\)/.test(src),
    f + ': the refused write is reported, so the user can be told instead of losing work silently');

  // The read-through itself is still there (cross-tab propagation depends on it).
  assert(READ_THROUGH.test(src),
    f + ': the cross-document read-through is kept — other tabs and iframes still see each other\'s writes');
});

/* ---------- The collections that used to bypass the guard ---------- */
console.log('Every collection in saveState goes through the anti-blanking guard');

['index.html', 'Offline System/index.html'].forEach(where => {
  const src = fs.readFileSync(path.join(ROOT, where), 'utf8');
  [
    ['voctrain_attendance', 'attendanceRecords'],
    ['voctrain_examResults', 'examResults'],
    ['voctrain_studentProfiles', 'studentProfiles'],
    ['voctrain_vcSessions', 'vcSessions']
  ].forEach(([key, varName]) => {
    assert(src.indexOf("saveCollection('" + key + "', " + varName + ")") !== -1,
      where + ': ' + key + ' is written through saveCollection()');

    /* The guard may still be bypassed in exactly one situation, and it is
       deliberate: when a trainee signs in, their device deliberately narrows
       each collection to their own records, so emptying it is the whole point
       and the anti-wipe guard must not stand in the way. Those writes are
       recognisable because they save a `my…` slice, never the full collection.
       Any OTHER raw write of one of these keys is the bug coming back. */
    const raw = src.match(
      new RegExp("CESTISStore\\.setItem\\('" + key + "', JSON\\.stringify\\(([A-Za-z_$][\\w$]*)\\)", 'g')) || [];
    const offenders = raw.filter(m => !/\(my[A-Z]/.test(m));
    assert(offenders.length === 0,
      where + ': ' + key + ' is written raw only by the deliberate per-user narrowing ' +
      '(found ' + offenders.length + ' other raw write(s): ' + offenders.join(', ') + ')');
  });
});

/* ---------- The offline autosave counter ---------- */
console.log('The offline build declares the autosave counter it uses');

const offline = fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8');
assert(/var _lastAutoSaveWriteMark\s*=/.test(offline),
  'Offline System/index.html declares _lastAutoSaveWriteMark — it was used and declared nowhere, ' +
  'so the auto-save threw on its first run and the cloud backup silently never happened');
assert(offline.split('_lastAutoSaveWriteMark').length - 1 >= 2,
  'and still uses it');

/* ---------- The offline core is no longer a different generation ---------- */
console.log('Both builds share one core, so a fix in one reaches the other');

const rootCore = fs.readFileSync(path.join(ROOT, 'cestis-core.js'), 'utf8');
const offCore = fs.readFileSync(path.join(ROOT, 'Offline System', 'cestis-core.js'), 'utf8');
assert(rootCore === offCore,
  'cestis-core.js is identical in both builds — the offline copy used to be an older generation, ' +
  'missing the guard that makes a collection unloseable, the trainee-identity rework and the ' +
  'idle-tick counter');

['guardedSet', 'wouldDiscardRecords', 'isEmptyValue', 'twinIndex', 'writes: 0'].forEach(fn => {
  assert(offCore.indexOf(fn) !== -1,
    'the offline core now carries ' + fn);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
