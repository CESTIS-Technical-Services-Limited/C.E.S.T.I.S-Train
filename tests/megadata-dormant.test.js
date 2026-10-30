/* MegaData is dormant: the everyday pages load only its small loader.

   No broker is set up, so every page ran MegaData in legacy mode — yet each
   of 12 everyday pages downloaded 10–13 MegaData scripts (70–122 KB) and
   wrapped every storage call, for nothing (audit OPS-7). They now load
   megadata/loader.js with their scripts listed in the tag; the loader fetches
   them only when this browser holds broker settings (MegaData-Admin.html's
   "Save on this device"). The MegaData admin pages still load everything.

   This pins: the everyday pages carry no MegaData script tag but the loader;
   each loader lists the page's scripts in their old order; the admin pages
   keep the whole stack; the loader never creates the database it looks in;
   and every glue file starts at once when it arrives after the page was read.
   tests/browser/megadata-smoke.js proves both paths in a real browser.

   Run: node tests/megadata-dormant.test.js */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CORE = ['megadata/schemas.js', 'megadata/projections.js', 'megadata/dal.js', 'megadata/adapter-idb.js', 'megadata/broker-client.js',
  'megadata/enforcement-shim.js', 'megadata/browser-sync.js', 'megadata/page-boot.js'];
const EVERYDAY = {
  'index.html': ['megadata/lms-collections.js', 'megadata/pages/roster-model.js', 'megadata/pages/docsync-model.js', 'megadata/pages/lms-model.js', 'megadata/pages/lms-page.js'],
  'CESTIS.Cashbook.html': ['megadata/cashbook-shared.js', 'megadata/pages/roster-model.js', 'megadata/pages/cashbook-model.js', 'megadata/pages/cb-page.js'],
  'Cert-Transcript-Requests.html': ['megadata/pages/ctr-model.js', 'megadata/pages/ctr-page.js'],
  'Finance.Invoice.html': ['megadata/pages/roster-model.js', 'megadata/pages/findoc-model.js', 'megadata/pages/findoc-page.js'],
  'Finance.Quote.html': ['megadata/pages/roster-model.js', 'megadata/pages/findoc-model.js', 'megadata/pages/findoc-page.js'],
  'Finance.Purchase.Order.html': ['megadata/pages/roster-model.js', 'megadata/pages/findoc-model.js', 'megadata/pages/findoc-page.js'],
  'Finance.Payment.Voucher.html': ['megadata/pages/roster-model.js', 'megadata/pages/docsync-model.js', 'megadata/pages/voucher-page.js'],
  'School.Fee.html': ['megadata/pages/roster-model.js', 'megadata/pages/fee-model.js', 'megadata/pages/fee-page.js'],
  'Staff.Clock.in.html': ['megadata/pages/roster-model.js', 'megadata/pages/docsync-model.js', 'megadata/pages/ps-model.js', 'megadata/pages/clock-page.js'],
  'Staff.Payslip.html': ['megadata/pages/roster-model.js', 'megadata/pages/docsync-model.js', 'megadata/pages/ps-model.js', 'megadata/pages/ps-page.js'],
  'Student-Progress.html': ['megadata/pages/roster-model.js', 'megadata/pages/sp-page.js'],
  'Transcript-Grades.html': ['megadata/pages/roster-model.js', 'megadata/pages/docsync-model.js', 'megadata/pages/tg-model.js', 'megadata/pages/tg-page.js']
};

/* ---------- 1. Everyday pages: the loader only ---------- */
console.log('Everyday pages load only the MegaData loader, listing their scripts');
Object.keys(EVERYDAY).forEach(page => {
  const src = read(page);
  const tags = src.match(/<script src="megadata\/[^"]+"[^>]*>/g) || [];
  assert(tags.length === 1 && /^<script src="megadata\/loader\.js\?v=[0-9a-f]{8}" data-megadata="/.test(tags[0]), page + ': one MegaData tag, the loader (' + tags.length + ')');
  const listed = ((/data-megadata="([^"]*)"/.exec(tags[0] || '') || [])[1] || '').split(/\s+/).filter(Boolean);
  const want = CORE.concat(EVERYDAY[page]);
  assert(JSON.stringify(listed.map(x => x.split('?')[0])) === JSON.stringify(want), page + ': it lists the page\'s MegaData scripts in their old order');
  assert(listed.every(x => /\?v=[0-9a-f]{8}$/.test(x) && fs.existsSync(path.join(ROOT, x.split('?')[0]))), page + ': each with its content tag, each a real file');
});
const everyPage = fs.readdirSync(ROOT).filter(f => /\.html$/.test(f));
const stillLoading = everyPage.filter(f => !/^MegaData-/.test(f) && /<script src="megadata\/(?!loader\.js)/.test(read(f)));
assert(stillLoading.length === 0, 'no other page loads MegaData up front: ' + stillLoading.join(', '));

/* ---------- 2. The MegaData admin pages keep the stack ---------- */
console.log('The MegaData admin pages still load the whole stack');
['MegaData-Admin.html', 'MegaData-Adjudication.html'].forEach(page => {
  const src = read(page);
  CORE.forEach(f => assert(src.indexOf('<script src="' + f + '?v=') !== -1, page + ' loads ' + f));
  assert(src.indexOf('megadata/loader.js') === -1, page + ' does not need the loader');
});

/* ---------- 3. The loader ---------- */
console.log('The loader looks without creating anything, and loads in order');
const L = read('megadata/loader.js');
assert(/idb\.open\(DB, 1\)/.test(L) && /onupgradeneeded = function \(\) \{ try \{ req\.transaction\.abort\(\); \}/.test(L),
  'a database that does not exist is never created (its creation is cancelled)');
assert(/'meta' \+ SEP \+ 'brokerConfig'/.test(L) && /bc\.url && bc\.secret/.test(L), 'it reads the broker settings MegaData-Admin stores (meta/brokerConfig: url and secret)');
assert(L.indexOf("var DB = 'CESTIS_MEGA'") !== -1 && read('megadata/adapter-idb.js').indexOf("dbName = dbName || 'CESTIS_MEGA'") !== -1 &&
  read('megadata/adapter-idb.js').indexOf("indexedDB.open(dbName, 1)") !== -1 && read('megadata/pages/admin-model.js').indexOf("CONFIG_NS = 'meta', CONFIG_KEY = 'brokerConfig'") !== -1,
  'the same database, version and key the MegaData adapter and admin page use');
assert(/s\.async = false/.test(L) && /loadInOrder\(i \+ 1\)/.test(L), 'scripts are loaded one after another, in the listed order');
assert(/window\.__cestisMegaLoad = /.test(L) && /'dormant'/.test(L) && /'loaded'/.test(L), 'and it says what it did (dormant or loaded)');

/* ---------- 4. The glue starts when it arrives late ---------- */
console.log('Every page glue starts at once when loaded after the page was read');
fs.readdirSync(path.join(ROOT, 'megadata', 'pages')).filter(f => /-page\.js$/.test(f)).forEach(f => {
  const g = read('megadata/pages/' + f);
  assert(g.indexOf("(document.readyState === 'loading' ? function (f) { window.addEventListener('DOMContentLoaded', f); } : function (f) { f(); })(function () {") !== -1 &&
    g.indexOf("window.addEventListener('DOMContentLoaded', function () {") === -1, f + ' starts at once if the page is already read');
});

/* ---------- 5. The Offline System ships the loader ---------- */
assert(require('../tools/build-offline.js').plan().has('megadata/loader.js'), 'the Offline System ships the loader');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
