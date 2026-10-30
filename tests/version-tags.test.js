/* Every page asks for the shared files it loads with a ?v= tag made from that
   file's content (tools/stamp-versions.js), so a changed file can never be
   served from a browser's old copy, and nobody has to remember to bump a tag.

   This fails when:
     - a page's tag does not match its file (someone changed cestis-core.js and
       did not run `npm run stamp` / `npm run build:offline`);
     - a page loads a local shared script or stylesheet with no tag at all;
     - the Offline System's generated pages carry tags its own files disagree
       with (they are byte copies, so this is the same check over there).

   Run: node tests/version-tags.test.js */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const stamp = require('../tools/stamp-versions.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------- 1. The site's pages ---------- */
console.log('Every page\'s ?v= tags match the files they name');
const r = stamp.stampAll({ write: false });
assert(r.pages >= 15 && r.tags >= 150, 'the stamp reads the site\'s pages (' + r.pages + ' pages, ' + r.tags + ' tags)');
assert(r.changed.length === 0, 'no tag is out of date — run `npm run stamp` (or `npm run build:offline`) and commit:\n      ' +
  r.changed.slice(0, 15).map(c => c.page + ': ' + c.file + '?v=' + c.from + ' → ' + c.to).join('\n      '));
assert(r.untagged.length === 0, 'every local shared script and stylesheet is loaded with a tag:\n      ' +
  r.untagged.map(u => u.page + ': ' + u.file).join('\n      '));
assert(r.missing.length === 0, 'every tagged file exists: ' + r.missing.map(m => m.page + ' → ' + m.file).join(', '));
['index.html', 'School.Fee.html', 'Transcript-Grades.html', 'CESTIS.Cashbook.html', 'Staff.Payslip.html', 'MegaData-Admin.html'].forEach(p => {
  assert(stamp.pages().indexOf(p) !== -1, 'the stamp covers ' + p);
});
const coreTag = /cestis-core\.js\?v=([0-9a-f]{8})/.exec(read('index.html'));
assert(coreTag && coreTag[1] === stamp.hashOf(path.join(ROOT, 'cestis-core.js')), 'index.html asks for cestis-core.js by the first 8 hex digits of its SHA-256');

/* ---------- 2. The Offline System's generated pages ---------- */
console.log('So do the Offline System\'s copies');
const off = stamp.stampAll({ write: false, base: path.join(ROOT, 'Offline System') });
assert(off.pages >= 15, 'the Offline System\'s pages are read too (' + off.pages + ')');
assert(off.changed.length === 0, 'and their tags match the offline copies of the files — run `npm run build:offline`:\n      ' +
  off.changed.slice(0, 10).map(c => c.page + ': ' + c.file).join('\n      '));

/* ---------- 3. The stamp itself ---------- */
console.log('The stamp: content in, tag out; only local files; idempotent');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-stamp-'));
try {
  fs.mkdirSync(path.join(tmp, 'Pages'));
  fs.mkdirSync(path.join(tmp, 'lib'));
  fs.writeFileSync(path.join(tmp, 'lib', 'a.js'), 'var a = 1;\n');
  fs.writeFileSync(path.join(tmp, 'b.css'), 'body{}\n');
  const page = [
    '<script src="lib/a.js?v=20261030d"></script>',
    '<link rel="stylesheet" href="b.css?v=1">',
    '<script src="https://cdn.example.org/lib/a.js?v=9"></script>',
    '<script>var LAZY = [\'lib/a.js?v=old\'];</script>',
    '<script src="lib/gone.js?v=3"></script>',
    '<script src="lib/new.js"></script>'
  ].join('\n');
  fs.writeFileSync(path.join(tmp, 'lib', 'new.js'), '1;');
  fs.writeFileSync(path.join(tmp, 'index.html'), page);
  fs.writeFileSync(path.join(tmp, 'Pages', 'x.html'), '<script src="../lib/a.js?v=2"></script>');
  const ha = stamp.hashOf(path.join(tmp, 'lib', 'a.js')), hb = stamp.hashOf(path.join(tmp, 'b.css'));
  assert(/^[0-9a-f]{8}$/.test(ha) && ha !== hb, 'a tag is 8 hex digits of the file\'s hash');
  const one = stamp.stampAll({ write: true, base: tmp });
  const out = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
  assert(out.indexOf('src="lib/a.js?v=' + ha + '"') !== -1 && out.indexOf('href="b.css?v=' + hb + '"') !== -1, 'script and stylesheet tags are stamped');
  assert(out.indexOf("'lib/a.js?v=" + ha + "'") !== -1, 'and a file a page loads on demand (a quoted name in its script)');
  assert(out.indexOf('https://cdn.example.org/lib/a.js?v=9') !== -1, 'another site\'s address is never touched');
  assert(out.indexOf('lib/gone.js?v=3') !== -1 && one.missing.some(m => m.file === 'lib/gone.js'), 'a missing file keeps its tag and is reported');
  assert(one.untagged.some(u => u.file === 'lib/new.js'), 'a shared script with no tag is reported');
  assert(fs.readFileSync(path.join(tmp, 'Pages', 'x.html'), 'utf8') === '<script src="../lib/a.js?v=' + ha + '"></script>', 'a page in a folder is stamped relative to itself');
  const two = stamp.stampAll({ write: true, base: tmp });
  assert(two.changed.length === 0 && fs.readFileSync(path.join(tmp, 'index.html'), 'utf8') === out, 'stamping twice changes nothing');
  fs.writeFileSync(path.join(tmp, 'lib', 'a.js'), 'var a = 2;\n');
  const three = stamp.stampAll({ write: false, base: tmp });
  assert(three.changed.length === 3 && three.changed.every(c => c.file.indexOf('a.js') !== -1), 'changing a file changes its tag on every page that loads it, and only its tag');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---------- 4. Wiring ---------- */
console.log('One command keeps the tags and the Offline System right');
const pkg = JSON.parse(read('package.json'));
assert(pkg.scripts.stamp === 'node tools/stamp-versions.js', '`npm run stamp` stamps the tags');
const build = read('tools/build-offline.js');
assert(/require\('\.\/stamp-versions\.js'\)/.test(build) && /stampAll\(\{ write: true \}\)/.test(build) && /stampAll\(\{ write: false \}\)/.test(build),
  '`npm run build:offline` stamps before it regenerates, and its --check checks the tags');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
