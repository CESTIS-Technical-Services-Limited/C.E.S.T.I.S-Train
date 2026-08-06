/* Gate 1 (spec §8, reformulated per the Section 0 verdict): every standalone
   JS file parses clean. `node --check` cannot read HTML; for embedded page
   scripts the real-browser smoke suite (zero uncaught page errors on live
   pages) is the current executable stand-in, and the extraction-based lint
   lands with the cutover tooling. Run: node tests/verify-syntax.js */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP = [/node_modules/, /vendor\//, /megadata-bootstrap-staging/, /\.git\//];
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const rel = path.relative(ROOT, full);
    if (SKIP.some(re => re.test(rel + '/'))) continue;
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full);
    else if (f.endsWith('.js') && !f.endsWith('.gs')) files.push(rel);
  }
})(ROOT);

let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
  if (r.status !== 0) { failed++; console.log('  ✗ ' + f + ': ' + (r.stderr || '').split('\n')[0]); }
}
console.log(files.length + ' JS files checked, ' + failed + ' failed');
if (failed) process.exitCode = 1;
