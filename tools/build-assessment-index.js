#!/usr/bin/env node
/* ============================================================================
   tools/build-assessment-index.js — check every prepared question bank and
   list them in assessments/index.json.

   The Assessments page reads assessments/index.json to know which of the
   Centre's units have prepared assessments (CESTISCore.assessments.matchBank:
   the programme and the unit code, else the unit's title), and fetches a
   bank file only when it is needed — never on a trainee's page.

   USE
     node tools/build-assessment-index.js           check every bank, rewrite the index
     node tools/build-assessment-index.js --check   change nothing; exit 1 if a bank has a
                                                    mistake or the index is out of date
   tests/assessments-bank.test.js runs --check as part of `npm test`.
   The format of a bank: assessments/README.md.
   ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const Core = require('../cestis-core.js');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'assessments');
const INDEX = path.join(DIR, 'index.json');

function bankFiles() {
  const out = [];
  fs.readdirSync(DIR, { withFileTypes: true }).forEach(d => {
    if (!d.isDirectory() || d.name === 'assets' || d.name.charAt(0) === '.') return;
    fs.readdirSync(path.join(DIR, d.name)).filter(f => /\.json$/.test(f)).sort().forEach(f => out.push(d.name + '/' + f));
  });
  return out.sort();
}

function build() {
  const problems = [], banks = [];
  bankFiles().forEach(rel => {
    let bank;
    try { bank = JSON.parse(fs.readFileSync(path.join(DIR, rel), 'utf8')); }
    catch (e) { problems.push(rel + ': not valid JSON (' + e.message + ')'); return; }
    const chk = Core.assessments.checkBank(bank);
    chk.problems.forEach(p => problems.push(rel + ': ' + p));
    if (!chk.ok) return;
    const q = bank.qualification || {};
    banks.push({ file: rel, programme: bank.programme, qualId: q.id || '', qualTitle: q.title || '', qualCode: q.code || '', level: bank.level == null ? '' : bank.level,
      unitCode: bank.unit.code || '', unitTitle: bank.unit.title || '', written: bank.written || '', status: bank.status || 'to-check' });
  });
  const keys = {};
  banks.forEach(b => {
    const k = Core.assessments.slug(b.programme) + '|' + (Core.assessments.normCode(b.unitCode) || Core.assessments.normTitle(b.unitTitle)) + '|' + b.level;
    if (keys[k]) problems.push(b.file + ': the same unit as ' + keys[k]);
    keys[k] = b.file;
  });
  return { index: { format: 'cestis-assessment-banks', version: 1, banks }, problems };
}

module.exports = { build, bankFiles, INDEX };

if (require.main === module) {
  const check = process.argv.includes('--check');
  const r = build();
  const text = JSON.stringify(r.index, null, 2) + '\n';
  r.problems.forEach(p => console.error('  ' + p));
  if (check) {
    const now = fs.existsSync(INDEX) ? fs.readFileSync(INDEX, 'utf8') : '';
    if (now !== text) console.error('assessments/index.json is out of date: run  node tools/build-assessment-index.js');
    if (r.problems.length || now !== text) process.exit(1);
    console.log(r.index.banks.length + ' bank(s), every one complete; the index is up to date.');
  } else {
    fs.writeFileSync(INDEX, text);
    console.log('assessments/index.json: ' + r.index.banks.length + ' bank(s)' + (r.problems.length ? '; ' + r.problems.length + ' problem(s) above — those banks are left out' : '') + '.');
    if (r.problems.length) process.exit(1);
  }
}
