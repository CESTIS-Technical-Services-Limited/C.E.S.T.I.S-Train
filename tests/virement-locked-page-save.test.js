/* A Virement page that was refused saves nothing when its tab closes.

   What happened (found by tests/browser/upgrade-no-data-loss.js, Google
   Drive scenario): the Virement page now opens only for a signed-in
   dashboard session (CESTISCore.sessionAccess.guard). A refused visit — a
   trainee typing the address, a dashboard session that has ended — never
   runs virOpenPage(), so the page never reads the store: in memory the
   deletion list is empty and the cashbook mirror is {}. But closing or
   hiding the tab still ran the page's "final save" (beforeunload and
   visibilitychange call saveAllData() and saveCloudCache()), and those wrote
   the empty deletion list over cesti_virement_deleted_ids and {} over
   cesti_virement_cloud_cache. On the upgraded office PC the Centre's record
   of its deleted virement request was gone after one refused visit, so the
   request could come back from any copy that still held it.

   Pinned here, with the real functions and handlers from
   Virement.Request.html:
     - a refused page's tab closing or hiding leaves every stored value as it
       was;
     - virOpenPage() reads the store before it allows saving;
     - an opened page still saves on close, deletions included.

   Run: node tests/virement-locked-page-save.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'Virement.Request.html'), 'utf8');
// The balanced { … } block that starts at the first "{" at or after `from`.
function blockAt(src, from) {
  let depth = 0;
  for (let i = src.indexOf('{', from); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(from, i + 1); }
  }
  throw new Error('unbalanced braces in Virement.Request.html');
}
function extractFunction(name) {
  const m = new RegExp('function ' + name + '\\s*\\(').exec(SRC);
  if (!m) throw new Error('Virement.Request.html no longer defines ' + name + '()');
  return blockAt(SRC, m.index);
}
// The page's own close / hide handlers, exactly as written.
function extractListener(target, event) {
  const at = SRC.indexOf(target + ".addEventListener('" + event + "'");
  if (at === -1) throw new Error('Virement.Request.html no longer listens for ' + event);
  return blockAt(SRC, at) + ');';
}
// The flag, if the page declares one (a page without it fails below, not here).
const FLAG = (/\n(?:var|let) virPageOpened = false;/.exec(SRC) || [''])[0].replace('let ', 'var ');

const DELETED = '[1760000300003]';
const CACHE = JSON.stringify({ '2026/2027_Q3': { budget: { Rent: 120000 }, transactions: [{ id: 100, deposit: 425000 }] } });
const VIREMENTS = JSON.stringify([{ id: 1760000300001, status: 'Pending', lines: [] }]);

function page() {
  const backing = { cesti_virements: VIREMENTS, cesti_virement_deleted_ids: DELETED, cesti_virement_cloud_cache: CACHE };
  const listeners = {};
  const sb = {
    CESTISStore: { getItem: k => (k in backing ? backing[k] : null), setItem: (k, v) => { backing[k] = String(v); }, removeItem: k => { delete backing[k]; } },
    console: { log() {}, warn() {}, error() {} }, alert() {},
    document: { visibilityState: 'visible', addEventListener: (ev, fn) => { listeners['document:' + ev] = fn; } },
    JSON, Object, Array, String, Set, Date, Math, Number
  };
  sb.window = { addEventListener: (ev, fn) => { listeners['window:' + ev] = fn; } };
  vm.createContext(sb);
  vm.runInContext([
    "var virementRequests = []; var deletedRequestIds = new Set(); var cloudQuarterCache = {};",
    "var DELETED_IDS_KEY = 'cesti_virement_deleted_ids'; var VIREMENT_CLOUD_CACHE_KEY = 'cesti_virement_cloud_cache';",
    "function captureFormDraft() {}",
    FLAG,
    ...['vrSignatures', 'vrContentRev', 'vrValidSignatures', 'vrIsApproved', 'vrMergeRequest', 'deduplicateRequests',
      'saveAllData', 'loadAllData', 'saveCloudCache', 'loadCloudCache'].map(extractFunction),
    extractListener('window', 'beforeunload'),
    extractListener('document', 'visibilitychange')
  ].join('\n\n'), sb);
  return { sb, backing, listeners };
}

console.log('A refused page (it never opened) saves nothing when its tab closes or hides');
let p = page();
p.listeners['window:beforeunload']({});
p.sb.document.visibilityState = 'hidden';
p.listeners['document:visibilitychange']();
assertEq(p.backing.cesti_virement_deleted_ids, DELETED, 'the Centre\'s deleted-request list is untouched');
assertEq(p.backing.cesti_virement_cloud_cache, CACHE, 'the cashbook mirror is untouched');
assertEq(p.backing.cesti_virements, VIREMENTS, 'the requests are untouched');

console.log('The page reads the store before it allows saving');
const open = extractFunction('virOpenPage');
const iLoad = open.indexOf('loadAllData()'), iCache = open.indexOf('loadCloudCache()'), iFlag = open.indexOf('virPageOpened = true');
assert(iLoad !== -1 && iCache !== -1 && iFlag > iLoad && iFlag > iCache,
  'virOpenPage() loads the requests and the mirror, then marks the page opened');

console.log('An opened page still saves on close, its deletions included');
p = page();
vm.runInContext('loadAllData(); loadCloudCache(); virPageOpened = true; deletedRequestIds.add(1760000300004);', p.sb);
p.listeners['window:beforeunload']({});
assertEq(p.backing.cesti_virement_deleted_ids, '[1760000300003,1760000300004]', 'the deletion made on the page is saved with the old one');
assertEq(p.backing.cesti_virement_cloud_cache, CACHE, 'the mirror it loaded is saved back as it was');

console.log('Summary: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
