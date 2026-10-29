/* A dropout stays "Incomplete" when the course ends.
   Run: node tests/course-end-keeps-dropouts.test.js

   What used to go wrong (audit M5): the course-end sweep
   (CESTISCore.courseEnd.decide) left alone only certified, collected and
   withdrawn trainees, and a stage a person set AFTER the course had ended.
   A trainee recorded as a dropout ("Incomplete") during the course was
   turned into Not Yet Competent the day the course ended — in the audit all
   4 Cosmetology dropouts became NYC, and were reported so to HEART/NSTA —
   although Student Progress's own stage edit promises "the sweep must not
   undo it".

   Pinned here: Incomplete, however it was set, is settled at course end; a
   stage a person chose (other than In Training) is settled too; a trainee in
   training is still judged by the rule exactly as before; and nothing is
   changed retroactively — a trainee the sweep already made NYC stays NYC. */
'use strict';

const Core = require('../cestis-core.js');
const CE = Core.courseEnd;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const ENDED = { status: 'ended', endKey: '2026-07-31', readiness: null, nowIso: '2026-10-28T12:00:00.000Z' };
function sweep(s, opts) { const d = CE.decide(s, Object.assign({}, ENDED, opts || {})); CE.apply(s, d); return d; }

console.log('A dropout stays Incomplete when the course ends');
{
  const s = { id: 'C1', stage: 'incomplete' };            // as the audit's Centre held its dropouts
  const d = sweep(s);
  assert(s.stage === 'incomplete' && !d.changed, 'Incomplete (no marker at all) is not turned into NYC (outcome ' + d.outcome + ')');
  assert(d.outcome === 'settled', 'it counts as settled');
  const t = { id: 'C2', stage: 'incomplete', stageSetByUser: true };
  CE.markSetByUser(t, null);                               // set during the course: no end date stamped yet
  sweep(t);
  assert(t.stage === 'incomplete', 'Incomplete set by a person during the course stays Incomplete');
  const u = { id: 'C3', stage: 'Incomplete' };
  sweep(u);
  assert(u.stage === 'Incomplete', 'whatever the capitals');
  // With a unit catalogue that would otherwise judge them.
  const v = { id: 'C4', stage: 'incomplete' };
  sweep(v, { readiness: { known: true, missingCore: ['U1'], nycUnits: ['U1'], pendingUnits: [], total: 3, competent: 2 } });
  assert(v.stage === 'incomplete' && !v.courseEndState, 'even when the transcript says units are missing');
}

console.log('A stage a person chose is theirs');
{
  const s = { id: 'P1', stage: 'testing', stageSetByUser: true };
  sweep(s);
  assert(s.stage === 'testing', 'a person-set stage (here an applicant never admitted) is not overwritten with NYC');
}

console.log('A trainee in training is judged as before');
{
  const s = { id: 'T1', stage: 'training' };
  sweep(s);
  assert(s.stage === 'nyc' && s._nycAuto === true && s._nycForCourseEnd === '2026-07-31', 'no catalogue: Not Yet Competent, as before');
  const t = { id: 'T2', stage: 'training', stageSetByUser: true };
  sweep(t, { readiness: { known: true, missingCore: [], nycUnits: [], pendingUnits: [], total: 3, competent: 3 } });
  assert(t.stage === 'training' && t.courseEndState === 'ready', 'a person moved them into training: the ending still judges them (ready to certify)');
  const c = { id: 'T3', stage: 'certified' };
  sweep(c);
  assert(c.stage === 'certified', 'certified stays certified');
}

console.log('Nothing is changed retroactively');
{
  const s = { id: 'N1', stage: 'nyc', _nycAuto: true, _nycForCourseEnd: '2026-07-31' };   // a dropout the old sweep already turned into NYC
  const d = sweep(s);
  assert(s.stage === 'nyc' && !d.changed, 'a trainee the sweep already made NYC is left as stored');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
