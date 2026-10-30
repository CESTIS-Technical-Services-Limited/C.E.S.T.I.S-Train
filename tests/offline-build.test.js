/* "Offline System/" is generated from the main build, and must stay so.

   The offline folder used to be a hand-kept second copy of every page. It
   drifted ~250 changes behind the main dashboard, and the hand-porting itself
   broke it: its saveState() called a saveCollection() its copy never defined,
   so on the offline build nothing the dashboard saved was ever kept, and the
   Reports page threw on every admin sign-in. Nothing noticed, because the
   parity test only compared seven libraries.

   tools/build-offline.js now regenerates every shared file byte for byte.
   This test runs it in --check mode (into a scratch folder) and FAILS on any
   byte of difference with the committed "Offline System/" — so a change to a
   shared page that was not regenerated cannot pass `npm test`.

   It also pins the generator's own safety: it never writes, compares or
   deletes the offline build's own files (server, launchers, READMEs) or the
   Centre's data, certificate and user exports, and it refuses to build if the
   main build loses one of the switches the offline build relies on.

   Run: node tests/offline-build.test.js */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const build = require('../tools/build-offline.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');

/* ---------- 1. The committed folder is exactly what the generator makes ---------- */
console.log('"Offline System/" is exactly what tools/build-offline.js generates');
const problems = build.check();
assert(problems.length === 0,
  '"Offline System/" is out of date with the main build — run `node tools/build-offline.js` ' +
  '(or `npm run build:offline`) and commit the result. Differences:\n      ' + problems.slice(0, 20).join('\n      '));

const planned = build.plan();
assert(planned.size > 100, 'it ships the whole platform (' + planned.size + ' shared files)');
['index.html', 'cestis-core.js', 'cestis-page-cloud.js', 'cestis-offline-rtc.js', 'Student-Progress.html',
 'CESTIS.Cashbook.html', 'Income.Expenditure.html', 'income-expenditure-core.js', 'MegaData-Admin.html',
 'megadata/page-boot.js', 'vendor/peerjs-1.5.4.min.js', 'Pages/Administration.html', 'cestis-theme.css'].forEach(f => {
  assert(planned.has(f), 'the offline build ships ' + f);
});
['tests/build-parity.test.js', 'docs/00-INVENTORY.md', 'README.md', 'package.json', 'tools/build-offline.js',
 '1-MIGRATION-DRY-RUN.bat', 'megadata/bootstrap-cli.js', 'megadata/broker-appsscript/Code.gs'].forEach(f => {
  assert(!planned.has(f), 'and not the development-only ' + f);
});
assert(!Array.from(planned.keys()).some(f => /^Offline System\//.test(f) || /^\./.test(f) || /\/\./.test(f)),
  'nor itself, nor any dot-file');

/* ---------- 2. The offline build's own files are its own ---------- */
console.log('The offline build keeps its own server, launchers and READMEs');
['cestis-offline-server.js', 'cestis-offline-signalling.js', 'cestis-offline-cert.js', 'cestis-offline-store.js',
 'cestis-offline-gate.js', 'START-WINDOWS.bat', 'START-MAC.command', 'START-LINUX.sh', 'READ ME FIRST.txt',
 "data/READ ME - THIS IS THE CENTRE'S DATA.txt", 'package.json', '.gitignore',
 'tests/offline-server-hardening.test.js'].forEach(f => {
  assert(fs.existsSync(path.join(ROOT, 'Offline System', f)), f + ' exists in "Offline System/"');
  assert(build.OFFLINE_OWNED.some(rx => rx.test(f)) && !planned.has(f), 'and the generator never touches it');
});
const offTests = fs.readdirSync(path.join(ROOT, 'Offline System', 'tests'));
assert(offTests.every(f => /^offline-/.test(f)),
  'the offline folder carries only the offline server\'s own tests — no stale copies of the main suite (' + offTests.join(', ') + ')');
const offPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'Offline System', 'package.json'), 'utf8'));
offPkg.scripts.test.split('&&').map(s => s.trim().replace(/^node /, '')).forEach(t => {
  assert(fs.existsSync(path.join(ROOT, 'Offline System', t)), 'the offline package.json\'s test ' + t + ' exists');
});
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
// `npm test` runs tools/run-tests.js, whose SUITES list is the one to check.
const rootSuites = require('../tools/run-tests.js').SUITES;
assert(rootPkg.scripts.test === 'node tools/run-tests.js', '`npm test` runs every suite through tools/run-tests.js');
offTests.forEach(t => {
  assert(rootSuites.indexOf('Offline System/tests/' + t) !== -1, 'and the root `npm test` runs ' + t);
});
assert(rootPkg.scripts['build:offline'] === 'node tools/build-offline.js', '`npm run build:offline` regenerates the folder');

/* ---------- 3. Regenerating never touches the Centre's own data ---------- */
console.log('Regenerating never touches a running Centre\'s data');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-build-'));
try {
  const local = {
    'data/CESTIS_ALL_DATA.json': '{"data":{"voctrain_students":"[1,2,3]"}}',
    'data/.history/CESTIS_ALL_DATA.json/2026.json': '{}',
    'cert/cestis-lan-key.pem': 'KEY',
    'cert/lan-token': 'abc',
    'User Login/ann/account.json': '{"hash":"x"}',
    'READ ME FIRST.txt': 'the offline build\'s own',
    'old-page-nobody-ships.html': 'stale'
  };
  Object.keys(local).forEach(f => {
    fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
    fs.writeFileSync(path.join(tmp, f), local[f]);
  });
  const r = build.write(planned, tmp);
  assert(r.removed === 1 && !fs.existsSync(path.join(tmp, 'old-page-nobody-ships.html')),
    'a generated page the main build no longer has is removed');
  Object.keys(local).filter(f => f !== 'old-page-nobody-ships.html').forEach(f => {
    assert(fs.existsSync(path.join(tmp, f)) && fs.readFileSync(path.join(tmp, f), 'utf8') === local[f],
      f + ' is left exactly as it was');
  });
  assert(build.diff(planned, tmp).length === 0, 'and the folder now matches the plan');
  fs.writeFileSync(path.join(tmp, 'index.html'), 'hand-edited');
  assert(build.diff(planned, tmp).some(p => /differs:\s+index\.html/.test(p)),
    'a hand edit to a generated page is reported as drift');
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
}

/* ---------- 4. It refuses to build without the main build's switches ---------- */
console.log('It refuses to build on a broken assumption');
const hooks = build.REQUIRED_HOOKS;
hooks.push({ file: 'index.html', needles: ['this text is in no page at all'] });
let threw = null;
try { build.plan(); } catch (e) { threw = e; }
hooks.pop();
assert(threw && /no longer contains/.test(threw.message), 'a missing offline switch in the main build stops the build');
build.ADAPTATIONS.push({ file: 'index.html', anchor: '<script', insert: 'x' });
threw = null;
try { build.plan(); } catch (e) { threw = e; }
build.ADAPTATIONS.pop();
assert(threw && /exactly once/.test(threw.message), 'and an adaptation whose anchor is not unique stops it too');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
