#!/usr/bin/env node
/* tools/study-kit-writing/copy-shared.js — file a shared unit's kit under
   every programme that has the unit.

   A unit code several programmes share is written once (plan.js names the
   master). This copies the master kit to each other programme's path, with
   that programme's own programme, qualification, level and unit names from
   its exam bank. A copy that already exists is left alone unless --force.

   USE  node tools/study-kit-writing/copy-shared.js [--force] */
'use strict';
const fs = require('fs');
const path = require('path');
const { plan } = require('./plan.js');
const ROOT = path.join(__dirname, '..', '..');
const force = process.argv.includes('--force');
let made = 0;
plan().forEach(u => {
  const src = path.join(ROOT, 'study-kits', u.master.file);
  if (!fs.existsSync(src)) return;
  const kit = JSON.parse(fs.readFileSync(src, 'utf8'));
  u.copies.forEach(c => {
    const dest = path.join(ROOT, 'study-kits', c.file);
    if (fs.existsSync(dest) && !force) return;
    const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'assessments', c.file), 'utf8'));
    const copy = Object.assign({}, kit, { programme: bank.programme, qualification: bank.qualification, level: bank.level, unit: bank.unit });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(copy, null, 1) + '\n');
    made++;
  });
});
console.log(made + ' shared kit(s) filed under their other programmes.');
