/* A deletion list keeps each id exactly as it was written.

   What happened (found by tests/browser/upgrade-no-data-loss.js, Google
   Drive scenario): the Centre had deleted a virement request on the old
   build, which writes the Virement page's deletions as numbers —
   cesti_virement_deleted_ids = [1760000300003]. A brand-new PC signed in
   after the upgrade. Its Virement page had already saved an empty list, so
   the Drive copy was merged in by union (Core.unionTombstoneValues), and
   the union wrote every id back as TEXT: ["1760000300003"]. The deletion was
   still written down, but the Virement page checks its list with a Set of
   numbers (deletedRequestIds.has(r.id), r.id a number), and "1760000300003"
   is not 1760000300003. So on that PC the page no longer stopped the deleted
   request coming back from any copy that still held it — an old device's
   file, a backup, another tab.

   Pinned here, with the real cestis-core.js and the real function from
   Virement.Request.html:
     - the union keeps numbers as numbers and text as text;
     - 7 and "7" are still one deletion (the union adds nothing);
     - the page-cloud merge (Core.pageCloud.mergeKeys) and the master
       snapshot reconcile hand the Virement page a list it can use;
     - with that list the page strips the deleted request.

   Run: node tests/tombstone-id-types.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const VIREMENT = fs.readFileSync(path.join(ROOT, 'Virement.Request.html'), 'utf8');
function extractFunction(src, name) {
  const m = new RegExp('function ' + name + '\\(').exec(src);
  if (!m) throw new Error('Virement.Request.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

const DELETED = 1760000300003;
const KEY = 'cesti_virement_deleted_ids';

console.log('The union keeps each id as it was written');
assertEq(Core.unionTombstoneValues('[]', JSON.stringify([DELETED])), '[1760000300003]',
  'a number stays a number');
assertEq(Core.unionTombstoneValues('["STU-1"]', '["STU-2"]'), '["STU-1","STU-2"]',
  'text ids union exactly as before');
assertEq(Core.unionTombstoneValues('[7]', '["7"]'), null, '7 and "7" are one deletion — nothing is added');
assertEq(Core.unionTombstoneValues('["7"]', '[7]'), null, 'and the same the other way round');
const mixed = JSON.parse(Core.unionTombstoneValues('[1760000300002]', '["STU-9",1760000300003]'));
assert(mixed.indexOf(1760000300002) !== -1 && mixed.indexOf(DELETED) !== -1 && mixed.indexOf('STU-9') !== -1,
  'a mixed list keeps every id with its own type');
assertEq(Core.unionTombstoneValues('[2,1]', '[3]'), Core.unionTombstoneValues('[3,1]', '[2]'),
  'two devices holding the same deletions still write the same list');

console.log('A new PC merging the Centre\'s Drive copy keeps the deletion usable');
const merged = Core.pageCloud.mergeKeys({ cesti_virements: '[]', [KEY]: '[]' }, {},
  { [KEY]: JSON.stringify([DELETED]) }, { [KEY]: '2026-10-01T10:00:00.000Z' }, {});
const pcList = JSON.parse(merged.data[KEY]);
assert(pcList.indexOf(DELETED) !== -1, 'the page-cloud merge keeps the deleted request id as a number — got ' + merged.data[KEY]);

console.log('The Virement page strips the deleted request with that list');
const sandbox = {
  virementRequests: [{ id: 1760000300001, status: 'Pending' }, { id: DELETED, status: 'Pending' }],
  deletedRequestIds: new Set(pcList),
  vrMergeRequest: function () {}
};
vm.createContext(sandbox);
vm.runInContext(extractFunction(VIREMENT, 'deduplicateRequests') + '\ndeduplicateRequests();\nthis.out = virementRequests;', sandbox);
assertEq(sandbox.out.map(r => r.id).join(','), '1760000300001', 'the deleted request does not come back');

console.log('Summary: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
