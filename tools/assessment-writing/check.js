/* Check prepared question banks before they go into the repo.
   Usage: node /home/user/cestis-work/banks/check.js <bank.json> [more.json ...]
   Runs the system's own CESTISCore.assessments.checkBank, then the house rules:
   the unit and qualification exactly as the Centre lists them, right answers
   spread over a-d, the right option not usually the longest, no repeated
   questions, the marks the format expects, and no pass mark in the file. */
'use strict';
const fs = require('fs');
const path = require('path');
const Core = require(path.join(__dirname, '..', '..', 'cestis-core.js'));
const WORK = JSON.parse(fs.readFileSync(path.join(__dirname, 'worklist-l2-core.json'), 'utf8'));
const quals = {}; WORK.quals.forEach(q => { quals[q.id] = q; });
const units = {}; WORK.units.forEach(u => { units[u.code] = u; });
const cats = Core.Transcript.seedCatalogs();
const titleOf = {}; cats.forEach(q => (q.units || []).forEach(u => { titleOf[q.id + '|' + u.code] = u.name; }));

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
let bad = 0;
process.argv.slice(2).forEach(file => {
  const problems = [];
  let b;
  try { b = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.log('✗ ' + file + ': not valid JSON (' + e.message + ')'); bad++; return; }
  const chk = Core.assessments.checkBank(b);
  chk.problems.forEach(p => problems.push(p));
  const q = b.qualification || {};
  const known = quals[q.id];
  if (!known) problems.push('qualification.id "' + q.id + '" is not one of the Centre\'s');
  else {
    if (q.title !== known.title) problems.push('qualification.title must be exactly "' + known.title + '"');
    if ((q.code || '') !== (known.code || '')) problems.push('qualification.code must be exactly "' + (known.code || '') + '"');
    if (b.programme !== known.skillArea) problems.push('programme must be exactly "' + known.skillArea + '"');
    if (Number(b.level) !== Number(known.level)) problems.push('level must be ' + known.level);
    const t = titleOf[q.id + '|' + (b.unit && b.unit.code)];
    if (t == null) problems.push('unit ' + (b.unit && b.unit.code) + ' is not in ' + q.id);
    else if (b.unit.title !== t) problems.push('unit.title must be exactly "' + t + '"');
  }
  const want = (b.unit && b.unit.code ? b.unit.code.toLowerCase() : '') + '.json';
  if (path.basename(file) !== want) problems.push('the file must be named ' + want);
  if (b.status !== 'to-check') problems.push('status must be "to-check"');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.written || '')) problems.push('written must be a date like 2026-11-01');
  ['theory1', 'theory2'].forEach(k => { if (b[k] && b[k].passMark != null) problems.push(k + ': remove passMark (the Centre\'s 65% applies)'); });
  const t1 = (b.theory1 && b.theory1.questions) || [];
  if (b.theory1 && Number(b.theory1.minutes) !== 150) problems.push('theory1.minutes must be 150');
  if (b.theory2 && Number(b.theory2.minutes) !== 215) problems.push('theory2.minutes must be 215');
  const pos = [0, 0, 0, 0]; let longest = 0;
  t1.forEach(x => {
    if (typeof x.answer === 'number') pos[x.answer]++;
    const o = x.options || [];
    const L = o.map(s => String(s).length), r = L[x.answer];
    if (r != null && L.every((l, i) => i === x.answer || l < r)) longest++;
  });
  if (t1.length === 45) {
    pos.forEach((n, i) => { if (n < 7 || n > 16) problems.push('right answers are not spread: option ' + 'abcd'[i] + ' is right ' + n + ' times (keep each between 7 and 16)'); });
    let shortest = 0; t1.forEach(x => { const L = (x.options || []).map(s => String(s).length), r = L[x.answer]; if (r != null && L.every((l, i) => i === x.answer || l > r)) shortest++; });
    let extreme = 0; t1.forEach(x => { const L = (x.options || []).map(s => String(s).length), r = L[x.answer]; if (r != null && (r >= Math.max.apply(null, L) || r <= Math.min.apply(null, L))) extreme++; });
    if (extreme < 9) problems.push('the right option is almost never the longest or the shortest (' + extreme + ' of 45, at least 9): a trainee could rule out both ends — make it the longest or shortest (or tied) more often');
    if (shortest > 16) problems.push('the right option is the shortest in ' + shortest + ' of 45 questions (at most 16): vary the lengths');
    if (longest > 16) problems.push('the right option is the longest in ' + longest + ' of 45 questions (at most 16): make wrong options as full as the right one');
  }
  const stems = {};
  t1.concat((b.theory2 && b.theory2.shortAnswers) || [], (b.theory2 && b.theory2.essays) || []).forEach(x => {
    const k = norm(x.stem); if (!k) return;
    if (stems[k]) problems.push('a question is asked twice: "' + String(x.stem).slice(0, 70) + '"');
    stems[k] = 1;
  });
  ((b.theory2 && b.theory2.shortAnswers) || []).forEach((x, i) => { if (Number(x.marks) !== 2) problems.push('short answer ' + (i + 1) + ': marks must be 2'); });
  ((b.theory2 && b.theory2.essays) || []).forEach((x, i) => {
    if (Number(x.marks) !== 5) problems.push('essay ' + (i + 1) + ': marks must be 5');
    if ((x.markingPoints || []).length < 3) problems.push('essay ' + (i + 1) + ': give at least 3 marking points');
    if (String(x.modelAnswer || '').length < 300) problems.push('essay ' + (i + 1) + ': the model answer is too short for a 5-mark essay');
  });
  ['practical1', 'practical2'].forEach(k => {
    const p = b[k] || {};
    if ((p.photos || []).length < 4) problems.push(k + ': list at least 4 photos to take');
    if ((p.checklist || []).length < 5) problems.push(k + ': give at least 5 checks for the assessor');
    if (!p.time) problems.push(k + ': give the time allowed');
    if (!(p.materials || []).length) problems.push(k + ': list the materials');
  });
  if (b.practical1 && b.practical2 && norm(b.practical1.title) === norm(b.practical2.title)) problems.push('the two practicals must be different tasks');
  if (/\b60\s*-?\s*Hz\b/i.test(JSON.stringify(b))) problems.push('Jamaica\'s mains supply is 50 Hz: remove or correct every "60 Hz"');
  if (problems.length) { bad++; console.log('✗ ' + file + '\n  - ' + problems.join('\n  - ')); }
  else console.log('✓ ' + file + '  (answers a-d: ' + pos.join('/') + ', right option longest in ' + longest + ')');
});
if (bad) { console.log('\n' + bad + ' file(s) need fixing'); process.exit(1); }
