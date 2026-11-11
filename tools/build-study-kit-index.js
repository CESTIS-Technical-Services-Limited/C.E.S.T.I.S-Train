#!/usr/bin/env node
/* ============================================================================
   tools/build-study-kit-index.js — check every study kit and list them in
   study-kits/index.json.

   The Resources page reads study-kits/index.json to know which of the
   Centre's units have a study kit (CESTISCore.studyKits.matchKit: the
   programme and the unit code, else the unit's title), and the kit page
   (study-kits/kit.html) fetches one kit when it is opened.

   Every kit is checked against study-kits/SCHEMA.md, against its unit's exam
   bank (assessments/<the same path>: the same programme, qualification, level
   and unit), and its practice questions against that bank's questions: a
   practice question too close to an exam question is refused.

   USE
     node tools/build-study-kit-index.js                 check every kit, rewrite the index
     node tools/build-study-kit-index.js --check         change nothing; exit 1 if a kit has a
                                                         mistake or the index is out of date
     node tools/build-study-kit-index.js --file <path>   check one kit, change nothing
   tests/study-kits.test.js runs --check as part of `npm test`.
   ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const Core = require('../cestis-core.js');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'study-kits');
const BANKS = path.join(ROOT, 'assessments');
const INDEX = path.join(DIR, 'index.json');
const K = Core.studyKits;

function kitFiles() {
  const out = [];
  if (!fs.existsSync(DIR)) return out;
  fs.readdirSync(DIR, { withFileTypes: true }).forEach(d => {
    if (!d.isDirectory() || d.name.charAt(0) === '.') return;
    fs.readdirSync(path.join(DIR, d.name)).filter(f => /\.json$/.test(f)).sort().forEach(f => out.push(d.name + '/' + f));
  });
  return out.sort();
}

/* rel: 'folder/unit.json' -> { kit, entry, problems } */
function checkOne(rel) {
  const problems = [];
  const say = p => problems.push(rel + ': ' + p);
  if (!K.safeFile(rel)) say('the file name must be <folder>/<unitcode>.json, small letters, digits and dashes.');
  let text, kit;
  try { text = fs.readFileSync(path.join(DIR, rel), 'utf8'); kit = JSON.parse(text); }
  catch (e) { say('not valid JSON (' + e.message + ')'); return { problems }; }
  const chk = K.checkKit(kit, text);
  chk.problems.forEach(say);
  let bank = null;
  const bankPath = path.join(BANKS, rel);
  if (!fs.existsSync(bankPath)) say('there is no exam bank at assessments/' + rel + ' for this unit.');
  else {
    try { bank = JSON.parse(fs.readFileSync(bankPath, 'utf8')); } catch (e) { say('its exam bank is not valid JSON.'); }
  }
  if (bank && chk.ok) {
    const q = kit.qualification || {}, bq = bank.qualification || {};
    if (kit.programme !== bank.programme) say('programme "' + kit.programme + '" is not the exam bank\'s ("' + bank.programme + '").');
    if (q.id !== bq.id || q.title !== bq.title || q.code !== bq.code) say('qualification is not the exam bank\'s (' + [bq.id, bq.title, bq.code].join(', ') + ').');
    if (kit.level !== bank.level) say('level ' + kit.level + ' is not the exam bank\'s (' + bank.level + ').');
    if (kit.unit.code !== bank.unit.code || kit.unit.title !== bank.unit.title) say('unit is not the exam bank\'s (' + bank.unit.code + ' ' + bank.unit.title + ').');
    K.overlap(kit, bank).forEach(o => say('practice question ' + o.id + ' is ' + o.why + ' as exam question ' + o.with + ': write a different one.'));
  }
  if (problems.length) return { kit, problems };
  const q = kit.qualification || {};
  return {
    kit, problems,
    entry: { file: rel, programme: kit.programme, qualId: q.id || '', qualTitle: q.title || '', qualCode: q.code || '', level: kit.level == null ? '' : kit.level,
      unitCode: kit.unit.code || '', unitTitle: kit.unit.title || '', written: kit.written || '', status: kit.status,
      sections: chk.counts.sections, questions: chk.counts.questions }
  };
}

function build() {
  const problems = [], kits = [];
  kitFiles().forEach(rel => {
    const r = checkOne(rel);
    r.problems.forEach(p => problems.push(p));
    if (r.entry) kits.push(r.entry);
  });
  return { index: { format: 'cestis-study-kits', version: 1, kits }, problems };
}

module.exports = { build, checkOne, kitFiles, INDEX };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const fi = argv.indexOf('--file');
  if (fi !== -1) {
    let rel = String(argv[fi + 1] || '').replace(/\\/g, '/').replace(/^\.?\/?(study-kits\/)?/, '');
    const r = checkOne(rel);
    r.problems.forEach(p => console.error('  ' + p));
    if (r.problems.length) { console.error(r.problems.length + ' problem(s).'); process.exit(1); }
    console.log(rel + ': complete — ' + r.entry.sections + ' sections, ' + r.entry.questions + ' practice questions, none like the exam\'s.');
    process.exit(0);
  }
  const check = argv.includes('--check');
  const r = build();
  const text = JSON.stringify(r.index, null, 2) + '\n';
  r.problems.forEach(p => console.error('  ' + p));
  if (check) {
    const now = fs.existsSync(INDEX) ? fs.readFileSync(INDEX, 'utf8') : '';
    if (now !== text) console.error('study-kits/index.json is out of date: run  node tools/build-study-kit-index.js');
    if (r.problems.length || now !== text) process.exit(1);
    console.log(r.index.kits.length + ' study kit(s), every one complete; the index is up to date.');
  } else {
    fs.writeFileSync(INDEX, text);
    console.log('study-kits/index.json: ' + r.index.kits.length + ' kit(s)' + (r.problems.length ? '; ' + r.problems.length + ' problem(s) above — those kits are left out' : '') + '.');
    if (r.problems.length) process.exit(1);
  }
}
