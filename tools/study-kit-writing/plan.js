#!/usr/bin/env node
/* tools/study-kit-writing/plan.js — the writing plan for the study kits.

   One kit per unit, at the same path as the unit's exam bank. A unit several
   programmes share (the same unit code) is written ONCE, under the first
   programme in PROGRAMME_ORDER, and filed under the others by
   copy-shared.js. The units still to write are put in batches of a few
   units from one programme, core trade units first.

   USE
     node tools/study-kit-writing/plan.js            write batches.json, print a summary
     node tools/study-kit-writing/plan.js --status   how many kits are written, per programme */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, 'assessments', 'index.json'), 'utf8')).banks;
const OUT = path.join(__dirname, 'batches.json');
const PROGRAMME_ORDER = ['welding-fabrication', 'welding-fabrication-level-3', 'electrical-installation', 'electrical-installation-level-3', 'cosmetology',
  'beauty-therapy', 'hospitality-tourism', 'business-administration-level-5'];
const PER_BATCH = 5;
const folderOf = b => b.file.split('/')[0];
const rank = b => { const i = PROGRAMME_ORDER.indexOf(folderOf(b)); return i === -1 ? 99 : i; };
const has = file => fs.existsSync(path.join(ROOT, 'study-kits', file));

// The writer's copy of each unit code, and where its copies go.
function plan() {
  const byCode = {};
  INDEX.forEach(b => { (byCode[b.unitCode] = byCode[b.unitCode] || []).push(b); });
  const units = Object.keys(byCode).map(code => {
    const list = byCode[code].slice().sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file));
    // A unit already written somewhere is the master, wherever it is.
    const done = list.find(b => has(b.file));
    const master = done || list[0];
    return { code, master, copies: list.filter(b => b !== master), done: !!done };
  });
  return units;
}

if (require.main === module) {
  const units = plan();
  if (process.argv.includes('--status')) {
    const per = {};
    INDEX.forEach(b => { const f = folderOf(b); per[f] = per[f] || { kits: 0, of: 0 }; per[f].of++; if (has(b.file)) per[f].kits++; });
    Object.keys(per).sort().forEach(f => console.log(f.padEnd(34) + per[f].kits + ' / ' + per[f].of));
    const all = INDEX.filter(b => has(b.file)).length;
    console.log('all'.padEnd(34) + all + ' / ' + INDEX.length);
    process.exit(0);
  }
  const todo = units.filter(u => !u.done).sort((a, b) => rank(a.master) - rank(b.master) || a.master.file.localeCompare(b.master.file));
  // Batches from one programme at a time, core (trade) units before the
  // shared/general ones (those are written under the first programme that lists them).
  const general = /^(BSB|CRI|ITC|ITI|BMF|THT|THH|CSA|LMF|EEMCAD)/;
  const batches = [];
  PROGRAMME_ORDER.forEach(folder => {
    const mine = todo.filter(u => folderOf(u.master) === folder);
    const ordered = mine.filter(u => !general.test(u.code)).concat(mine.filter(u => general.test(u.code)));
    for (let i = 0; i < ordered.length; i += PER_BATCH) {
      batches.push({ id: 'B' + String(batches.length + 1).padStart(3, '0'), folder,
        units: ordered.slice(i, i + PER_BATCH).map(u => ({ file: u.master.file, code: u.code, title: u.master.unitTitle, level: u.master.level,
          qual: u.master.qualTitle, copies: u.copies.map(c => c.file) })) });
    }
  });
  fs.writeFileSync(OUT, JSON.stringify({ written: new Date().toISOString().slice(0, 10), perBatch: PER_BATCH, batches }, null, 1) + '\n');
  console.log(units.length + ' units (' + units.filter(u => u.done).length + ' written); ' + todo.length + ' to write in ' + batches.length + ' batches; ' +
    units.reduce((a, u) => a + u.copies.length, 0) + ' copies for shared units.');
}
module.exports = { plan, PROGRAMME_ORDER };
