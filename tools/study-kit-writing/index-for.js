#!/usr/bin/env node
/* tools/study-kit-writing/index-for.js — write study-kits/index.json for the
   kits of the finished batches only (and the pilots), while other batches
   are still being written: a commit then lists exactly the kits it holds.
   USE  node tools/study-kit-writing/index-for.js B005 B012 ...   (or --all-done) */
'use strict';
const fs = require('fs');
const path = require('path');
const tool = require('../build-study-kit-index.js');
const ROOT = path.join(__dirname, '..', '..');
const batches = require('./batches.json').batches;
const PILOTS = ['welding-fabrication/memfab0111c.json', 'electrical-installation/eemels0011b.json', 'cosmetology/csbcos0031c.json'];
const ids = process.argv.slice(2);
const done = fs.existsSync(path.join(__dirname, 'done.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'done.json'), 'utf8')) : [];
ids.forEach(id => { if (done.indexOf(id) === -1) done.push(id); });
done.sort();
const files = PILOTS.slice();
batches.filter(b => done.indexOf(b.id) !== -1).forEach(b => b.units.forEach(u => { files.push(u.file); (u.copies || []).forEach(c => files.push(c)); }));
const kits = [], problems = [];
files.filter(f => fs.existsSync(path.join(ROOT, 'study-kits', f))).sort().forEach(f => {
  const r = tool.checkOne(f);
  r.problems.forEach(p => problems.push(p));
  if (r.entry) kits.push(r.entry);
});
if (problems.length) { problems.forEach(p => console.error('  ' + p)); console.error(problems.length + ' problem(s): index not written.'); process.exit(1); }
fs.writeFileSync(tool.INDEX, JSON.stringify({ format: 'cestis-study-kits', version: 1, kits }, null, 2) + '\n');
fs.writeFileSync(path.join(__dirname, 'done.json'), JSON.stringify(done) + '\n');
console.log('study-kits/index.json: ' + kits.length + ' kit(s) from ' + done.length + ' finished batch(es) and the pilots.');
console.log(kits.map(k => k.file).join('\n'));
