#!/usr/bin/env node
/* tools/study-kit-writing/copy-shared.js — file a shared unit's kit under
   every programme that has the unit.

   A unit code several programmes share is written once (plan.js names the
   master). This copies the master kit to each other programme's path, with
   that programme's own programme, qualification, level and unit names from
   its exam bank. Only a FINISHED master is copied — its batch is in
   done.json (index-for.js keeps that list) and it passes the checker — and
   a copy is rewritten whenever its master has changed: copies are made
   here, never edited by hand.

   USE  node tools/study-kit-writing/copy-shared.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { plan } = require('./plan.js');
const tool = require('../build-study-kit-index.js');
const ROOT = path.join(__dirname, '..', '..');
const batches = require('./batches.json').batches;
const doneIds = fs.existsSync(path.join(__dirname, 'done.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'done.json'), 'utf8')) : [];
const finished = {};
batches.filter(b => doneIds.indexOf(b.id) !== -1).forEach(b => b.units.forEach(u => { finished[u.file] = 1; }));
let made = 0, skipped = 0;
plan().forEach(u => {
  if (!u.copies.length) return;
  const src = path.join(ROOT, 'study-kits', u.master.file);
  if (!fs.existsSync(src)) return;
  if (!finished[u.master.file] || tool.checkOne(u.master.file).problems.length) { skipped++; return; }
  const kit = JSON.parse(fs.readFileSync(src, 'utf8'));
  u.copies.forEach(c => {
    const dest = path.join(ROOT, 'study-kits', c.file);
    const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'assessments', c.file), 'utf8'));
    const copy = Object.assign({}, kit, { programme: bank.programme, qualification: bank.qualification, level: bank.level, unit: bank.unit });
    const text = JSON.stringify(copy, null, 1) + '\n';
    if (fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === text) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    made++;
  });
});
console.log(made + ' shared kit(s) filed under their other programmes' + (skipped ? '; ' + skipped + ' shared unit(s) still being written' : '') + '.');
