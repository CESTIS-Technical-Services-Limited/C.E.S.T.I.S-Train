/* The prepared question banks (assessments/*.json) and their index.
   Run: node tests/assessments-bank.test.js

   Every bank is complete (CESTISCore.assessments.checkBank), the index lists
   exactly the banks there are (node tools/build-assessment-index.js), and the
   sample Welding unit keeps to the content rules: one right answer per
   question, four different options, the right answers spread over the four
   places, no question asked twice, accepted short answers that mark
   themselves, a model answer and marking points for every essay, both
   practicals with photos, checks and safety points — and it makes the four
   tests the owner asked for. Banks are never loaded on a trainee's first
   page: no page names them in a script tag. */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Core = require('../cestis-core.js');
const A = Core.assessments;
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

console.log('Every bank complete; the index up to date');
{
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/build-assessment-index.js'), '--check'], { encoding: 'utf8' });
  assert(r.status === 0, 'node tools/build-assessment-index.js --check passes (' + (r.stderr || r.stdout).trim() + ')');
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'assessments/index.json'), 'utf8'));
  assert(idx.format === 'cestis-assessment-banks' && idx.version === 1 && Array.isArray(idx.banks) && idx.banks.length >= 1, 'the index lists the banks');
  idx.banks.forEach(b => {
    const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'assessments', b.file), 'utf8'));
    assert(A.checkBank(bank).ok, b.file + ' is complete');
    assert(bank.status === 'to-check', b.file + ' starts as "To check"');
  });
}

console.log('The sample: Welding Level 2, MEMFAB0042C (MMAW in the flat and horizontal positions)');
{
  const bank = require('../assessments/welding-fabrication/memfab0042c.json');
  const qs = bank.theory1.questions;
  assert(qs.length === 45 && bank.theory2.shortAnswers.length === 15 && bank.theory2.essays.length === 10, '45 multiple choice, 15 short answers, 10 essays');
  assert(qs.every(q => Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4), 'every question names one right option');
  assert(qs.every(q => new Set(q.options.map(o => o.toLowerCase().trim())).size === 4), 'four different options each');
  const spread = [0, 0, 0, 0]; qs.forEach(q => spread[q.answer]++);
  assert(spread.every(n => n >= 9 && n <= 14), 'the right answers spread over the four places (' + spread.join('/') + ')');
  const stems = new Set(qs.map(q => q.stem.toLowerCase()));
  assert(stems.size === 45, 'no question asked twice');
  assert(qs.every(q => q.options.every(o => o.length <= 140) && q.stem.length <= 200), 'questions and options short enough to read on a phone');
  // The right answer is never the only long option (a give-away).
  const giveaway = qs.filter(q => { const l = q.options.map(o => o.length); const r = l[q.answer]; return r > Math.max.apply(null, l.filter((x, i) => i !== q.answer)) * 1.3; });
  assert(giveaway.length <= 2, 'the right answer is not given away by being the longest option (' + giveaway.map(q => q.id).join(', ') + ')');
  const topics = new Set(qs.map(q => q.topic));
  assert(['Safety and PPE', 'Equipment', 'Electrodes', 'Joint preparation', 'Technique', 'Welding positions', 'Weld defects', 'Inspection'].every(t => topics.has(t)), 'safety, equipment, electrodes, preparation, technique, positions, defects and inspection all covered');
  assert(qs.filter(q => q.topic === 'Safety and PPE').length >= 6, 'safety asked about more than any single other thing');
  // Facts checked by hand, pinned so a careless edit is noticed.
  const right = id => { const q = qs.find(x => x.id === id); return q.options[q.answer]; };
  assert(right('T1-01') === 'Shade 10', 'shade 10 for a 3.2 mm electrode at 100–125 A');
  assert(/60 000 psi/.test(right('T1-16')) && /all positions/.test(right('T1-17')), 'E6013: 60 000 psi; the "1" means all positions');
  assert(/About 60°/.test(right('T1-23')) && /core wire/.test(right('T1-29')), 'a 60° single V; arc length about the core-wire diameter');
  assert(/heated electrode oven/.test(right('T1-19')), 'E7018 kept in a heated oven once opened');
  bank.theory2.shortAnswers.forEach(q => assert(q.accepted.every(a => Core.exams.shortAnswerMatches(a, q.accepted)), q.id + ': each accepted answer marks itself'));
  const sa = q => bank.theory2.shortAnswers.find(x => x.id === q);
  assert(Core.exams.shortAnswerMatches('  Shielded Metal Arc Welding ', sa('T2-S02').accepted) && !Core.exams.shortAnswerMatches('metal arc', sa('T2-S02').accepted), 'capitals and spaces aside; anything else waits for marking');
  bank.theory2.essays.forEach(q => assert(q.modelAnswer.length >= 200 && q.markingPoints.length >= 4 && q.marks === 5, q.id + ': a model answer and marking points for the marker'));
  ['practical1', 'practical2'].forEach(k => {
    const p = bank[k];
    assert(p.photos.length >= 5 && p.checklist.length >= 6 && p.safety.length >= 4 && p.materials.length >= 3 && /group/i.test(p.brief) && /hand in once/i.test(p.brief), k + ': a group task, photos to take, what is checked, safety and materials');
    assert(p.checklist.some(c => /PPE/.test(c)) && p.checklist.some(c => /tidy/.test(c)), k + ': PPE and a tidy, safe area are checked');
  });
  const qual = { id: 'QUAL-WEL-L2', title: 'WELDING LEVEL 2', code: 'MEM22423', skillArea: 'Welding & Fabrication', level: 2 };
  const seeded = Core.Transcript.seedCatalogs().find(q => q.id === 'QUAL-WEL-L2');
  const unit = seeded.units.find(u => u.code === 'MEMFAB0042C');
  assert(unit && A.matchBank(JSON.parse(fs.readFileSync(path.join(ROOT, 'assessments/index.json'), 'utf8')), qual, { code: unit.code, title: unit.name }), 'it answers to the Centre\'s own unit MEMFAB0042C in the Welding Level 2 plan');
  const t1 = A.bankToExam(bank, 'theory1', { id: 'EX-1', qual, unit: bank.unit }), t2 = A.bankToExam(bank, 'theory2', { id: 'EX-2', qual, unit: bank.unit });
  assert(t1.duration === 150 && Core.exams.questionCount(t1) === 45 && t2.duration === 215 && Core.exams.questionCount(t2) === 25, 'Theory 1: 45 in 2 h 30 min; Theory 2: 25 in 3 h 35 min');
  assert(Core.exams.keyProblems(t1.questionData).length === 0 && Core.exams.keyProblems(t2.questionData).length === 0, 'the test builder finds every key usable');
  const total2 = t2.questionData.reduce((n, q) => n + (Number(q.points) || 0), 0);
  assert(total2 === 80, 'Theory 2 is out of 80 (30 + 50)');
}

console.log('Banks are fetched only when staff open the Assessments page');
{
  const pages = ['index.html'].concat(fs.readdirSync(path.join(ROOT, 'Pages')).map(f => 'Pages/' + f));
  const tagged = pages.filter(p => /<script[^>]+assessments\//.test(fs.readFileSync(path.join(ROOT, p), 'utf8')));
  assert(tagged.length === 0, 'no page loads a bank with a script tag');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert(!/assessments\/[a-z-]+\/[a-z0-9]+\.json/.test(sw), 'the offline worker does not fetch banks on a first visit');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
