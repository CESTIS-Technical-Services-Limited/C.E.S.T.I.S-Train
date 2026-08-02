/* Unit tests for staff-appraisals.js (pure calculation/template layer).
   Expected figures are taken from the Centre's real completed instruments:
   - Coordinator (supervisory): S1 92, S2 167, S3 99, total 358/385 = 92.99% → 93%
   - Instructor (non-supervisory): S1 93, S2 169, total 262/280 = 93.57% → 94%
   Run: node tests/staff-appraisals.test.js */
'use strict';

const sapp = require('../staff-appraisals.js');
const {
  SAPP_TEMPLATES, SAPP_SECTION2, SAPP_SECTION3,
  sappCalc, sappCategory, sappPayReward, sappCycleFor, sappDueCycle, sappDueStatus
} = sapp;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* ---------- 1. Template integrity ---------- */
console.log('Template integrity');
Object.keys(SAPP_TEMPLATES).forEach(k => {
  const tpl = SAPP_TEMPLATES[k];
  let total = 0;
  tpl.section1.forEach(obj => {
    const s = obj.indicators.reduce((a, i) => a + i[1], 0);
    assertEq(s, obj.weight, k + ' / "' + obj.name + '" indicator weights sum to the objective weight');
    total += s;
  });
  assertEq(total, 100, k + ' Section 1 weights sum to 100');
});
assertEq(SAPP_SECTION2.reduce((a, f) => a + f.max, 0), 180, 'Section 2 factor maxima sum to 180');
assertEq(SAPP_SECTION3.reduce((a, f) => a + f.max, 0), 105, 'Section 3 factor maxima sum to 105');
SAPP_SECTION2.concat(SAPP_SECTION3).forEach(f =>
  assertEq(f.bullets.length * 5, f.max, '"' + f.name + '" max equals 5 × number of criteria'));

/* ---------- helpers to build score maps ---------- */
function s1Map(rows) { // rows: array per objective of arrays of actuals
  const m = {};
  rows.forEach((obj, oi) => obj.forEach((v, ii) => { m[oi + '_' + ii] = v; }));
  return m;
}
function facMap(rows) {
  const m = {};
  rows.forEach((f, fi) => f.forEach((v, bi) => { m[fi + '_' + bi] = v; }));
  return m;
}

/* ---------- 2. Coordinator (supervisory) — real document figures ---------- */
console.log('Coordinator instrument reproduction');
const coord = {
  template: 'coordinator',
  s1: s1Map([[2,2,2,4],[1,3,2,4,1,3],[6,3,2],[19],[2,2,2,3,2,2],[1,1,2,2],[1,1],[10,3,1,3]]),
  s2: facMap([[4,4,3,5,5],[5,5,4,5,5],[5,5,4,4],[4,5,5,5],[5,5,5,5],[5,4,5,5],[5,5,4],[4,5,4],[4,5],[5,5]]),
  s3: facMap([[5,5,4,4,5,5,5],[5,5,4,5,5,4,4],[5,5,5,5],[5,5,4]])
};
const cc = sappCalc(coord);
assertEq(cc.s1Total, 92, 'Coordinator Section 1 total');
assertEq(cc.s2Total, 167, 'Coordinator Section 2 total');
assertEq(cc.s3Total, 99, 'Coordinator Section 3 total');
assertEq(cc.grandTotal, 358, 'Coordinator grand total');
assertEq(cc.divisor, 385, 'Coordinator divisor (supervisory)');
assertEq(cc.finalPctExact, 92.99, 'Coordinator exact %');
assertEq(cc.finalPct, 93, 'Coordinator final % (correctly rounded, not truncated)');
assertEq(cc.category, 'Outstanding', 'Coordinator category');
assertEq(cc.payPct, 5.3, 'Coordinator payment reward %');
assert(cc.complete, 'Coordinator appraisal complete');

/* Factor averages divide by the NUMBER OF CRITERIA (instrument N.B.), not by 5 */
assertEq(cc.s2[2].avg, 4.5, 'Teamwork average 18/4 = 4.5');
assertEq(cc.s2[3].avg, 4.75, 'Relevance average 19/4 = 4.75');
assertEq(cc.s3[0].avg, 4.71, 'Leadership average 33/7 = 4.71');
assertEq(cc.s2[9].avg, 5, 'Attendance & Punctuality average 10/2 = 5');

/* ---------- 3. Instructor (non-supervisory) — real document figures ---------- */
console.log('Instructor instrument reproduction');
const inst = {
  template: 'instructor',
  s1: s1Map([[7,1,5,5],[2,2,2],[5,2,2],[19],[4,3,1,3],[2,4],[6,5,5,8]]),
  s2: facMap([[5,5,4,5,5],[5,4,5,5,4],[5,5,5,4],[5,5,4,5],[5,5,4,5],[5,4,4,5],[5,5,4],[5,5,4],[5,5],[5,4]])
};
const ic = sappCalc(inst);
assertEq(ic.s1Total, 93, 'Instructor Section 1 total');
assertEq(ic.s2Total, 169, 'Instructor Section 2 total');
assertEq(ic.s3Total, 0, 'Instructor Section 3 not scored');
assertEq(ic.divisor, 280, 'Instructor divisor (non-supervisory)');
assertEq(ic.grandTotal, 262, 'Instructor grand total');
assertEq(ic.finalPct, 94, 'Instructor final % (262/280 = 93.57 → 94)');
assertEq(ic.category, 'Outstanding', 'Instructor category');
assertEq(ic.payPct, 5.4, 'Instructor payment reward %');
assert(ic.complete, 'Instructor appraisal complete (S3 not required)');

/* ---------- 4. Clamping & incompleteness ---------- */
console.log('Clamping and completeness');
const clamped = sappCalc({ template: 'instructor', s1: { '0_0': 99 }, s2: { '0_0': 9 } });
assertEq(clamped.s1Rows[0].score, 8, 'Section 1 actual clamps to the indicator weight (8)');
assertEq(clamped.s2[0].total, 5, 'Section 2 score clamps to 5');
assert(!clamped.complete, 'Partially scored appraisal is incomplete');
assert(!clamped.s1Complete, 'Section 1 incomplete flagged');

/* ---------- 5. Categories & payment reward table ---------- */
console.log('Categories and payment reward');
assertEq(sappCategory(59), 'Unsatisfactory', '59% is Unsatisfactory');
assertEq(sappCategory(60), 'Meets Job Requirements', '60% Meets Job Requirements');
assertEq(sappCategory(79), 'Meets Job Requirements', '79% Meets Job Requirements');
assertEq(sappCategory(80), 'Commendable', '80% Commendable');
assertEq(sappCategory(89), 'Commendable', '89% Commendable');
assertEq(sappCategory(90), 'Outstanding', '90% Outstanding');
assertEq(sappPayReward(79), null, '79 → no payment reward');
assertEq(sappPayReward(80), 4.0, '80 → 4.0%');
assertEq(sappPayReward(92), 5.2, '92 → 5.2%');
assertEq(sappPayReward(98), 5.8, '98 → 5.8%');
assertEq(sappPayReward(100), 6.0, '100 → 6.0%');

/* ---------- 6. Appraisal cycle / due logic ---------- */
console.log('Cycle and due-date logic');
assertEq(sappCycleFor(new Date(2025, 3, 1)).key, '2025-2026', '1 Apr 2025 falls in cycle 2025-2026');
assertEq(sappCycleFor(new Date(2026, 2, 31)).key, '2025-2026', '31 Mar 2026 falls in cycle 2025-2026');
assertEq(sappDueCycle(new Date(2026, 1, 15)).key, '2024-2025', 'Mid-Feb 2026: still appraising 2024-2025');
assertEq(sappDueCycle(new Date(2026, 2, 5)).key, '2025-2026', '5 Mar 2026: window open for 2025-2026');
const stMar = sappDueStatus(new Date(2026, 2, 5));
assert(stMar.open && !stMar.overdue, 'Early March: window open, not overdue');
const stAug = sappDueStatus(new Date(2026, 7, 2));
assertEq(stAug.cycle.key, '2025-2026', 'Aug 2026: due cycle is 2025-2026');
assert(stAug.overdue, 'Aug 2026: past 30 April due date → overdue');
assertEq(stAug.dueLabel, '30 April 2026', 'Due label');

/* ---------- 7. Full-name rules & payslip name matching ---------- */
console.log('Full-name and payslip matching');
const { sappIsFullName, sappMatchPayslipName } = sapp;
assert(sappIsFullName('Rashaun Barrett'), '"Rashaun Barrett" is a full name');
assert(sappIsFullName('Tracy-Ann Johnson'), 'hyphenated first name accepted');
assert(sappIsFullName('Mr. Steve Anthony Barrett'), 'title + three names accepted');
assert(!sappIsFullName('Administrator'), 'single word rejected');
assert(!sappIsFullName('Admin'), '"Admin" rejected');
assert(!sappIsFullName('Mr. Smith'), 'title + surname only rejected (no first name)');
assert(!sappIsFullName(''), 'empty rejected');
assert(!sappIsFullName('J Smith'), 'single-letter first name rejected');

const emps = ['Rashaun Barrett', 'Tracy-Ann Johnson', 'Steve Barrett', 'Horaldo Archer'];
assertEq(sappMatchPayslipName('Rashaun Barrett', emps), 'Rashaun Barrett', 'exact first+last match');
assertEq(sappMatchPayslipName('rashaun BARRETT', emps), 'Rashaun Barrett', 'case-insensitive match');
assertEq(sappMatchPayslipName('Mr. Steve Anthony Barrett', emps), 'Steve Barrett', 'middle name + title ignored; first+last must agree');
assertEq(sappMatchPayslipName('Tracy Ann Johnson', emps), 'Tracy-Ann Johnson', 'hyphen-insensitive match');
assertEq(sappMatchPayslipName('Steve Johnson', emps), null, 'first matches one employee, last another → no match');
assertEq(sappMatchPayslipName('Administrator', emps), null, 'staff without full name never matches');
assertEq(sappMatchPayslipName('Jason Hall', emps), null, 'unknown name → no match');

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
