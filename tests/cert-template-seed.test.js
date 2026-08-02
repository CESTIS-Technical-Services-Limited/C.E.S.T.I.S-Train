/* Unit tests for cert-template-seed.js — the certificate template seed built
   from the Centre's NVQ-J Qualification Plans.

   These tests pin the REAL cluster structure of each programme (cluster count,
   unit count, taught hours, credits) so that a careless edit to the seed data
   cannot silently change what a trainee's certificate claims they completed.

   Run: node tests/cert-template-seed.test.js */
'use strict';

const Seed = require('../cert-template-seed.js');
const Core = require('../cestis-core.js');
const CT = Core.certTemplate;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* The figures below are transcribed from the Qualification Plans themselves.
   course, planCode, clusters, core units, elective units, core hrs, total hrs,
   core credits, total credits */
const PLANS = [
  { course: 'Beauty Therapy',                        code: 'CSB21424', clusters: 8,  units: 28, electives: 3, coreHours: 2160, allHours: 2340, coreCredits: 76,  totalCredits: 82  },
  { course: 'Cosmetology',                           code: 'CSB21323', clusters: 10, units: 47, electives: 3, coreHours: 3270, allHours: 3465, coreCredits: 122, totalCredits: 129 },
  { course: 'Electrical Installation and Maintenance', code: 'EEM20723', clusters: 12, units: 40, electives: 0, coreHours: 2520, allHours: 2520, coreCredits: 99,  totalCredits: 99  },
  { course: 'Welding',                               code: 'MEM22423', clusters: 11, units: 43, electives: 3, coreHours: 2670, allHours: 2925, coreCredits: 109, totalCredits: 117 },
  { course: 'Hospitality Villa/Properties Services', code: 'THH22522', clusters: 16, units: 58, electives: 3, coreHours: 3690, allHours: 3810, coreCredits: 153, totalCredits: 159 }
];

/* ---------- 1. Every skill area the Centre trains has a seed ---------- */
console.log('Seed coverage');
assertEq(Seed.CERT_TEMPLATE_SEED.length, 7, 'seven qualification plans seeded');
assertEq(Seed.seedSummary().length, 7, 'summary covers every programme');
PLANS.forEach(function (p) {
  assert(!!Seed.findSeed(p.course), p.course + ' has a seed entry');
});
assert(!!Seed.findSeed('Electrical Installation Level 3'), 'Electrical Installation Level 3 seeded');
assert(!!Seed.findSeed('Welding Level 3'), 'Welding Level 3 seeded');

/* Every entry carries the plan code, the qualification title and an industry */
Seed.CERT_TEMPLATE_SEED.forEach(function (s) {
  assert(/^[A-Z]{3}\d{5}$/.test(s.planCode), s.course + ' carries a valid plan code (' + s.planCode + ')');
  assert(/NVQ/i.test(s.qualification), s.course + ' names its NVQ-J qualification');
  assert(!!s.industry, s.course + ' names its industry');
  assertEq(s.courseType, 'Full-time', s.course + ' is a full-time programme');
});

/* ---------- 2. Actual cluster counts match the Qualification Plans ---------- */
console.log('Cluster counts and unit totals');
PLANS.forEach(function (p) {
  const s = Seed.findSeed(p.course);
  assertEq(s.planCode, p.code, p.course + ' plan code');
  assertEq(s.clusters.length, p.clusters, p.course + ' has ' + p.clusters + ' clusters');
  const units = s.clusters.reduce(function (a, c) { return a + c.units.length; }, 0);
  assertEq(units, p.units, p.course + ' has ' + p.units + ' core units across its clusters');
  assertEq(s.electives ? s.electives.units.length : 0, p.electives, p.course + ' elective unit count');
  assertEq(s.coreCredits, p.coreCredits, p.course + ' core credits');
  assertEq(s.totalCredits, p.totalCredits, p.course + ' total credits');
});

/* No cluster may be empty or unnamed — an empty cluster would print a blank
   heading with no competencies under it on the certificate. */
Seed.CERT_TEMPLATE_SEED.forEach(function (s) {
  s.clusters.forEach(function (c, i) {
    assert(!!c.name && c.name.trim().length > 3, s.course + ' cluster ' + (i + 1) + ' is named');
    assert(c.units.length > 0, s.course + ' cluster "' + c.name + '" lists its units');
    assert(c.units.every(function (u) { return typeof u === 'string' && u.trim().length > 3; }),
      s.course + ' cluster "' + c.name + '" units are all real titles');
  });
});

/* Unit titles must not repeat inside one programme */
Seed.CERT_TEMPLATE_SEED.forEach(function (s) {
  const all = [];
  s.clusters.forEach(function (c) { c.units.forEach(function (u) { all.push(u.toLowerCase()); }); });
  assertEq(new Set(all).size, all.length, s.course + ' lists no duplicated unit');
});

/* ---------- 3. The two Level 3 plans are flagged as derived ---------- */
console.log('Level 3 plans flagged for confirmation');
/* MEM32507 (2007) and MEM30215 (2015) predate clustering: they list Core and
   Elective units with no clustering table. Their clusters are grouped here to
   follow the Level 2 pattern and MUST stay flagged so the Centre confirms them. */
assertEq(Seed.findSeed('ELECTRICAL L3').clustersDerived, true, 'Electrical L3 clusters flagged as derived');
assertEq(Seed.findSeed('WELDING L3').clustersDerived, true, 'Welding L3 clusters flagged as derived');
PLANS.forEach(function (p) {
  assert(!Seed.findSeed(p.course).clustersDerived, p.course + ' clusters come straight from the plan');
});
assertEq(Seed.seedSummary().filter(function (r) { return r.derived; }).length, 2, 'exactly two derived programmes');

/* ---------- 4. Course-name matching ---------- */
console.log('Course name matching');
assertEq(Seed.findSeed('WELDING L2').planCode, 'MEM22423', 'shouted alias resolves');
assertEq(Seed.findSeed('welding l2').planCode, 'MEM22423', 'lower case resolves');
assertEq(Seed.findSeed('  Welding   L2  ').planCode, 'MEM22423', 'stray whitespace tolerated');
assertEq(Seed.findSeed('Welding').planCode, 'MEM22423', 'canonical name resolves');
assertEq(Seed.findSeed('Welding L3').planCode, 'MEM30215', 'Level 3 is a distinct programme');
assertEq(Seed.findSeed('Welding & Fabrication').planCode, 'MEM22423', 'the Centre\'s own course name resolves');
assertEq(Seed.findSeed('ELECTRICAL L2').planCode, 'EEM20723', 'electrical alias resolves');
assertEq(Seed.findSeed('Electrical Installation L3').planCode, 'MEM32507', 'electrical L3 alias resolves');
assertEq(Seed.findSeed('General Beauty Therapy').planCode, 'CSB21424', 'qualification wording resolves');
assertEq(Seed.findSeed('HOSPITALITY SERVICES L2').planCode, 'THH22522', 'hospitality alias resolves');
assertEq(Seed.findSeed('Basket Weaving'), null, 'an unknown course has no seed');
assertEq(Seed.findSeed(''), null, 'blank name has no seed');
assertEq(Seed.findSeed(null), null, 'null-safe');

/* Aliases must be unique across programmes, or a course would seed the wrong plan */
const seen = {};
Seed.CERT_TEMPLATE_SEED.forEach(function (s) {
  [s.course].concat(s.aliases || []).forEach(function (n) {
    const k = n.toLowerCase().trim();
    assert(!seen[k], 'name "' + n + '" belongs to exactly one programme');
    seen[k] = s.course;
  });
});

/* ---------- 5. Clusters become certificate units ---------- */
console.log('Clusters as certificate units');
const wSeed = Seed.findSeed('Welding L2');
let cl = Seed.seedClusters(wSeed, false);
assertEq(cl.length, 11, 'core clusters only');
assertEq(cl[0].name, 'Use Workshop Tools Safely', 'first cluster name preserved');
assertEq(cl[0].contactHours, 330, 'cluster hours carried across');
assertEq(cl[0].topics.length, 4, 'cluster units become the certificate topics');
assert(cl[0].topics[0].indexOf('Occupational Health and Safety') > -1, 'unit title text preserved verbatim');
cl = Seed.seedClusters(wSeed, true);
assertEq(cl.length, 12, 'electives added as a further cluster when requested');
assert(/\(Electives\)$/.test(cl[11].name), 'the elective cluster is labelled as such');
assertEq(Seed.seedClusters(null, true).length, 0, 'null seed yields no clusters');

/* Mutating the returned clusters must not corrupt the seed */
cl[0].topics.push('TAMPERED');
assertEq(Seed.findSeed('Welding L2').clusters[0].units.length, 4, 'seed data is not aliased by callers');

/* ---------- 6. Duration is the real taught hours ---------- */
console.log('Programme duration');
PLANS.forEach(function (p) {
  const s = Seed.findSeed(p.course);
  assertEq(Seed.seedDuration(s, false), p.coreHours + ' Contact Hours', p.course + ' core duration');
  assertEq(Seed.seedDuration(s, true), p.allHours + ' Contact Hours', p.course + ' duration including electives');
});
assertEq(Seed.seedDuration(null, true), '', 'no seed -> no duration');

/* ---------- 7. templateContentFor builds the course-content half ---------- */
console.log('templateContentFor');
const tpl = Seed.templateContentFor('WELDING L2');
assertEq(tpl.courseFullName, 'Welding', 'template names the canonical programme');
assertEq(tpl.courseType, 'Full-time', 'full-time, so the certificate says CLUSTERS');
assertEq(tpl.programmeCode, 'MEM22423', 'plan code becomes the programme code');
assertEq(tpl.modules.length, 12, 'clusters (with electives) become the certificate units');
assertEq(tpl.clusterCount, 11, 'the real core cluster count is recorded');
assertEq(tpl.totalCredits, 117, 'credits recorded');
assertEq(tpl.programmeSpecs.duration, '2925 Contact Hours', 'duration filled from the plan');
assertEq(tpl.programmeSpecs.industry, 'Metal Engineering and Maintenance', 'industry filled from the plan');
assertEq(tpl.qualification, 'NVQ-J Level 2 in Welding', 'qualification title carried');
assertEq(tpl.competencies.length, 0,
  'competencies deliberately left empty so the renderer derives them from what was taught');
assertEq(Seed.templateContentFor('Welding L2', { includeElectives: false }).modules.length, 11,
  'electives can be left off');
assertEq(Seed.templateContentFor('Nothing At All'), null, 'unknown course seeds nothing');

/* The seed must never carry design fields — the design comes from the base
   template, and overwriting it here would undo the Centre's corrected look. */
console.log('Seed carries no design');
CT.LOOK_FIELDS.forEach(function (f) {
  assert(!(f in tpl), 'seeded content does not touch the design field "' + f + '"');
});

/* ---------- 8. End to end with the certificate renderer ---------- */
console.log('End to end with the renderer');
PLANS.concat([{ course: 'Welding L3' }, { course: 'Electrical Installation L3' }]).forEach(function (p) {
  const t = Seed.templateContentFor(p.course);
  const page2 = CT.page2Content(t);
  assertEq(page2.unitHeading, 'CLUSTERS COMPLETED', p.course + ' prints CLUSTERS, not MODULES');
  assertEq(page2.competencies.length, t.modules.length,
    p.course + ' derives one Technical Competency group per cluster');
  assertEq(page2.competencies[0].category, t.modules[0].name,
    p.course + ' first competency group is the first cluster');
  assert(page2.competencies.every(function (c) { return c.items.length > 0; }),
    p.course + ' every competency group lists competencies');
  assert(page2.competencies.every(function (c) { return c.derived === true; }),
    p.course + ' competencies are marked as derived from the clusters');
});

/* Seeding content onto a template must leave the inherited design alone */
const base = {
  courseFullName: 'Photovoltaic Installer', courseType: 'Short Course',
  bgPage1: 'data:image/png;base64,P1', bgPage2: 'data:image/png;base64,P2',
  textPositions: { p1NameX: 52, p1NameY: 49, p1NameSize: 59 },
  bodyText: { completionLine: 'has successfully completed' },
  signatureLeft: 'Programme Coordinator/ Principal', signatureRight: 'Chairman of CMC Board',
  contactEmail: 'cestisadmn@gmail.com', contactPhone: '+(876) 679-0111',
  createdAt: '2026-01-01T00:00:00.000Z'
};
const seeded = Object.assign(CT.newFromBase(base, 'Welding L2'), Seed.templateContentFor('Welding L2'));
assertEq(seeded.bgPage1, 'data:image/png;base64,P1', 'seeding keeps the inherited page 1 background');
assertEq(seeded.textPositions.p1NameSize, 59, 'seeding keeps the inherited text positions');
assertEq(seeded.contactPhone, '+(876) 679-0111', 'seeding keeps the inherited contact details');
assertEq(seeded.signatureRight, 'Chairman of CMC Board', 'seeding keeps the inherited signature titles');
assertEq(seeded.courseType, 'Full-time', 'seeding corrects the course type to full-time');
assertEq(seeded.modules.length, 12, 'seeding fills in the real clusters');
assertEq(CT.page2Content(seeded).unitHeading, 'CLUSTERS COMPLETED', 'seeded template prints CLUSTERS');

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
