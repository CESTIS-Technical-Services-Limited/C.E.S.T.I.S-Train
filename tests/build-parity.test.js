/* The two builds must not drift apart, because a fix made in one never reaches
   the Centre running the other.

   What had happened: "Offline System" was a current page layer sitting on an old
   core. The dashboard page had been refreshed, so it carried the newest work,
   but the shared libraries underneath it had not. The offline build was
   therefore missing, among other things:

     - the guard that makes a collection unloseable (an empty value never
       replaces stored records) — and offline that is worse than online, because
       there is no Drive revision history to recover from;
     - the trainee-identity rework, so the same person written two ways stayed
       two records, listed twice and counted twice;
     - the write counter every idle-tick gate depends on, so five separate
       "has anything changed?" checks were permanently open and every tick did
       the full expensive work on every device;
     - the board portal's data and its virement rulings;
     - any pull after the page first opened, so a fee recorded on the office
       desktop stayed invisible on the Coordinator's laptop until somebody
       reloaded, and each push merged against a copy that had been stale all day.

   And one fix went the other way: the offline build knew not to treat a pull's
   own writes as user edits, while the main build did not — so the value it had
   just downloaded was stamped "now" and pushed straight back, and two devices
   could trade the same value between them indefinitely.

   Then it happened again, worse: the offline dashboard's saveState() called a
   saveCollection() its copy did not define (it had been hand-ported without
   its helper), so on the offline build NOTHING the dashboard saved was kept —
   every save showed "storage quota may be full" — and its Reports page threw
   on every admin sign-in (centreRollTally, likewise missing). This test was
   green throughout, because it only compared seven libraries.

   The offline folder is now GENERATED from the main build
   (tools/build-offline.js; tests/offline-build.test.js fails on any byte of
   drift). This test pins the properties that make that safe: every shared file
   is identical, the main build carries the switches the offline build needs,
   and no page in either build calls a function or links a file its own build
   does not have.

   Run: node tests/build-parity.test.js */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ---------- 1. The shared libraries are one copy, not two ---------- */
console.log('Both builds run the same shared libraries');

[
  'cestis-core.js',
  'cmc-portal.js',
  'staff-appraisals.js',
  'finance-docs.js',
  'finance-logos.js',
  'cert-template-seed.js',
  'transcript-assets.js'
].forEach(lib => {
  assert(read(lib) === read('Offline System/' + lib),
    lib + ' is identical in both builds — a fix in one now reaches the other');
});

/* cestis-page-cloud.js used to be two different files: the offline copy talked
   to the Centre's own server and had fallen hundreds of lines behind the main
   one (no readers, no onRestore on refresh, no shared writes). It is now ONE
   file that finds the Centre's server at run time and is inert without it. */
console.log('Both builds run ONE page-cloud, which finds the Centre\'s server by itself');

const rootPC = read('cestis-page-cloud.js');
const offPC = read('Offline System/cestis-page-cloud.js');

assert(rootPC === offPC, 'cestis-page-cloud.js is identical in both builds');
assert(/if \(API\._applying\) return r;/.test(rootPC),
  'a pull writing the cloud\'s copy back is not an edit made here — two devices used to trade it for ever');
assert(/API\._applying = true;/.test(rootPC) && /API\._applying = false;/.test(rootPC),
  'and the flag is set around the merge, not just declared');
assert(/_refreshWired/.test(rootPC), 'it keeps pulling after the page opens, rather than once at start-up');
assert(/'\/_cestis\/health'/.test(rootPC) && /LOCAL_BASE/.test(rootPC),
  'it can talk to the Centre\'s own server');
assert(/github\\\.io/.test(rootPC),
  'and does not even ask for it on GitHub Pages, so the online build is untouched');
assert(/records: true/.test(rootPC), 'on the Centre\'s server, record collections merge record by record');

/* ---------- 1b. Every shared file, not just the libraries ---------- */
console.log('Every file the two builds share is byte-identical');
(function () {
  const build = require('../tools/build-offline.js');
  const planned = build.plan();
  let same = 0, differ = [];
  planned.forEach((buf, rel) => {
    let off = null;
    try { off = fs.readFileSync(path.join(ROOT, 'Offline System', rel)); } catch (e) {}
    if (off && buf.equals(off)) same++; else differ.push(rel);
  });
  assert(differ.length === 0, 'all ' + planned.size + ' shared files are identical in "Offline System/" (differ: ' +
    differ.slice(0, 8).join(', ') + ') — run `node tools/build-offline.js`');
  assert(build.ADAPTATIONS.length === 0,
    'and none of them is patched on the way: the main build carries the offline switches itself');
  ['index.html', 'Student-Progress.html', 'CESTIS.Cashbook.html', 'Staff.Payslip.html', 'Staff.Clock.in.html',
   'Virement.Request.html', 'School.Fee.html', 'Income.Expenditure.html', 'income-expenditure-core.js'].forEach(f => {
    assert(planned.has(f), f + ' ships in the offline build');
  });
})();

/* ---------- 1c. A page never calls a function its own build lacks ---------- */
console.log('The dashboard defines every helper its saves depend on, in both builds');
['index.html', 'Offline System/index.html'].forEach(where => {
  const src = read(where);
  ['saveCollection', 'centreRollTally', 'persistUserAccounts', 'mirrorActiveAttendance', 'syncStampAll'].forEach(fn => {
    assert(new RegExp('function ' + fn + '\\s*\\(').test(src),
      where + ' defines ' + fn + '() — the offline copy once called saveCollection() 21 times and defined it nowhere');
  });
  // Every bare call inside saveState() resolves to a definition in this file.
  const body = (src.match(/\nfunction saveState\(\) \{[\s\S]*?\n\}\n/) || [''])[0];
  // Code only: comments mention things like refreshXView() that are not calls.
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert(body.length > 0, where + ': saveState() found');
  const called = {};
  code.replace(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g, (m, name) => { called[name] = true; return m; });
  const KEYWORDS = { function: 1, if: 1, for: 1, while: 1, catch: 1, switch: 1, return: 1, typeof: 1, saveState: 1 };
  Object.keys(called).filter(n => !KEYWORDS[n]).forEach(n => {
    const defined = new RegExp('function ' + n.replace(/\$/g, '\\$') + '\\s*\\(').test(src) ||
                    new RegExp('(var|let|const) ' + n + '\\s*=').test(src);
    assert(defined, where + ': saveState() calls ' + n + '(), which this file defines');
  });
});

/* ---------- 1d. The offline switches stay in the main build ---------- */
console.log('The main build carries the offline switches, inert online');
const rootIdx = read('index.html');
assert(rootIdx.indexOf('<script src="cestis-offline-rtc.js') !== -1,
  'the dashboard loads the video shim, which changes nothing unless the Centre\'s server answers');
assert(/CESTISPageCloud\.initLan\(\{[\s\S]*?file: 'CESTIS_LMS_Dashboard\.json'/.test(rootIdx),
  'the dashboard registers its shared store ONLY on the Centre\'s network (initLan), never online');
assert(!/CESTISPageCloud\.init\(\{\s*page: 'LMS Dashboard'/.test(rootIdx),
  'and never through plain init(), which would sync the whole dashboard to Drive online');
assert(/function syncStampAll\(\) \{[\s\S]{0,600}CESTISPageCloud\.now\(\)/.test(rootIdx),
  'records are stamped by the Centre server\'s clock on its network (device clocks there are unset); by this device\'s elsewhere');
const rtc = read('cestis-offline-rtc.js');
assert(/probe\(\)\.then\(function \(on\) \{ offline = !!on; if \(offline\) wrap\(\); \}/.test(rtc),
  'the video shim wraps PeerJS only after the Centre\'s server has answered — online window.Peer is left alone');

/* ---------- 2. The guards the offline build was missing ---------- */
console.log('Every page that owns records guards its writes, in both builds');

[
  ['Student-Progress.html', 'spSaveCollection', 'voctrain_students'],
  ['Offline System/Student-Progress.html', 'spSaveCollection', 'voctrain_students'],
  ['School.Fee.html', 'feePersist', 'cestiSchoolFeeStudents'],
  ['Offline System/School.Fee.html', 'feePersist', 'cestiSchoolFeeStudents']
].forEach(([where, writer, key]) => {
  const src = read(where);
  assert(src.indexOf('function ' + writer + '(') !== -1,
    where + ': defines its guarded writer ' + writer + '()');
  assert(/guardedSet/.test(src),
    where + ': which goes through the rule that an empty value never replaces records');
  assert(src.indexOf("CESTISStore.setItem('" + key + "', JSON.stringify(") === -1,
    where + ': and ' + key + ' is no longer written raw, around the guard');
});

/* ---------- 3. The core carries what the offline build lacked ---------- */
console.log('The shared core carries the protections and the identity rework');

const core = read('Offline System/cestis-core.js');
[
  ['guardedSet', 'the write guard'],
  ['wouldDiscardRecords', 'the rule behind it'],
  ['isEmptyValue', 'and the emptiness test'],
  ['twinIndex', 'the trainee-identity index'],
  ['collapseSameNameStudents', 'the same-name collapse'],
  ['recordInQuarter', 'the quarter test the attendance merge needs'],
  ['writes: 0', 'the write counter every idle-tick gate depends on']
].forEach(([needle, what]) => {
  assert(core.indexOf(needle) !== -1, 'the offline core carries ' + what);
});

/* ---------- 4. Neither build is missing a page the other links to ---------- */
console.log('Neither build links to a page it does not have');

function walkHtml(dir, acc) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, f);
    const st = fs.statSync(path.join(ROOT, rel));
    if (st.isDirectory()) { if (!/node_modules|vendor|\.git/.test(f)) walkHtml(rel, acc); }
    else if (f.endsWith('.html')) acc.push(rel);
  }
  return acc;
}
const offlinePages = walkHtml('Offline System', []);
// Every local script, stylesheet and embedded page an offline page names must
// be in the offline folder — Income & Expenditure used to be linked from the
// main build only, and the offline build simply did not have it.
let checkedRefs = 0;
offlinePages.forEach(pg => {
  const src = read(pg);
  const dir = path.dirname(pg);
  const refs = [];
  src.replace(/<script[^>]+src="([^"]+)"/g, (m, u) => { refs.push(u); return m; });
  src.replace(/<link[^>]+href="([^"]+\.css[^"]*)"/g, (m, u) => { refs.push(u); return m; });
  src.replace(/\bsrc:\s*'([^'"]+\.html)[^']*'/g, (m, u) => { refs.push(u); return m; });
  // The MegaData scripts megadata/loader.js fetches on demand (listed in its tag).
  src.replace(/data-megadata="([^"]+)"/g, (m, list) => { list.split(/\s+/).forEach(u => { if (u) refs.push(u); }); return m; });
  refs.forEach(u => {
    if (/^(https?:|data:|\/\/|#|javascript:)/i.test(u)) return;
    const file = decodeURIComponent(u.split('?')[0].split('#')[0]);
    if (!file) return;
    checkedRefs++;
    assert(fs.existsSync(path.join(ROOT, dir, file)), pg + ' refers to ' + file + ', which the offline build ships');
  });
});
assert(checkedRefs > 50, 'the link check actually looked at the pages (' + checkedRefs + ' references)');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
