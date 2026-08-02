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
assertEq(tpl.competencies.length, 8, 'the plan\'s competency profile is seeded onto the template');
assertEq(tpl.competencies[0].category, 'Workshop Safety, Tools and Machines', 'first competency area');
assertEq(tpl.competencies[0].fromPlan, 'MEM22423', 'seeded competencies record the plan they came from');
assert(!('fromUnits' in tpl.competencies[0]), 'provenance is not carried onto the certificate');
assert(tpl.competencies.every(function (c) { return c.items.length > 0; }), 'every competency area states what the graduate can do');
assertEq(Seed.templateContentFor('Welding L2', { includeElectives: false }).modules.length, 11,
  'electives can be left off');
assertEq(Seed.templateContentFor('Welding L2', { includeElectives: false }).competencies.length, 7,
  'leaving electives off drops the elective competency area too');
assert(/\(Electives\)$/.test(tpl.competencies[7].category), 'the elective competency area is labelled as such');
assertEq(Seed.templateContentFor('Nothing At All'), null, 'unknown course seeds nothing');

/* The seed must never carry design fields — the design comes from the base
   template, and overwriting it here would undo the Centre's corrected look. */
console.log('Seed carries no design');
CT.LOOK_FIELDS.forEach(function (f) {
  assert(!(f in tpl), 'seeded content does not touch the design field "' + f + '"');
});

/* ---------- 8. The competency profile is grounded in the plan ----------

   TECHNICAL COMPETENCIES ACHIEVED is the Centre's wording for what a graduate
   can do; the units are what the trainee was actually assessed against. Each
   competency area therefore carries `fromUnits`, and these tests hold the two
   together: nothing may be claimed that the plan does not assess, and nothing
   the plan assesses may go unrepresented. Without this a competency statement
   could quietly drift into claiming a skill that was never taught.            */
console.log('Competency profile is grounded in the plan');
const normU = function (s) { return String(s).toLowerCase().trim().replace(/\s+/g, ' '); };

Seed.CERT_TEMPLATE_SEED.forEach(function (s) {
  const core = Seed.seedUnits(s, false).map(normU);
  const elective = (s.electives ? s.electives.units : []).map(normU);
  const claimed = [];

  assert((s.competencies || []).length >= 5, s.course + ' groups its competencies into technical areas');
  (s.competencies || []).forEach(function (c) {
    assert(!!c.category && c.category.trim().length > 3, s.course + ' competency area is named');
    assert((c.items || []).length > 0, s.course + ' area "' + c.category + '" states what the graduate can do');
    assert((c.fromUnits || []).length > 0, s.course + ' area "' + c.category + '" records the units it comes from');
    (c.fromUnits || []).forEach(function (u) {
      const isCore = core.indexOf(normU(u)) > -1;
      const isElective = elective.indexOf(normU(u)) > -1;
      assert(isCore || isElective,
        s.course + ' area "' + c.category + '" claims a unit that is in the plan — "' + u + '"');
      /* An elective area may only draw on elective units, and a core area only
         on core ones, or the certificate would credit an elective a trainee
         never took (or bury a core unit inside an optional heading). */
      if (c.elective) assert(isElective, s.course + ' elective area draws only on elective units — "' + u + '"');
      else assert(isCore, s.course + ' core area draws only on core units — "' + u + '"');
      claimed.push(normU(u));
    });
  });

  const uncoveredCore = core.filter(function (u) { return claimed.indexOf(u) === -1; });
  assertEq(uncoveredCore.length, 0,
    s.course + ' every core unit is represented in a competency area (missing: ' + uncoveredCore.join('; ') + ')');
  const uncoveredElective = elective.filter(function (u) { return claimed.indexOf(u) === -1; });
  assertEq(uncoveredElective.length, 0,
    s.course + ' every elective unit is represented (missing: ' + uncoveredElective.join('; ') + ')');
});

/* The whole point of seeding these: the right-hand column must no longer be a
   copy of the left-hand one. */
console.log('The two Page 2 columns say different things');
Seed.CERT_TEMPLATE_SEED.forEach(function (s) {
  const t = Seed.templateContentFor(s.course);
  const clusterNames = t.modules.map(function (m) { return normU(m.name); });
  const echoed = t.competencies.filter(function (c) { return clusterNames.indexOf(normU(c.category)) > -1; });
  assertEq(echoed.length, 0, s.course + ' no competency area simply repeats a cluster heading');
  /* No core area may reproduce a cluster's unit list — that was exactly the old
     behaviour, where the fallback echoed the clusters into both columns. The
     elective areas are exempt: an elective is three units long and its titles
     already read as outcomes, so restating them would only be a paraphrase. */
  const clusterLists = t.modules.map(function (m) { return m.topics.map(normU).join('|'); });
  const copied = t.competencies
    .filter(function (c) { return !/\(Electives\)$/.test(c.category); })
    .filter(function (c) { return clusterLists.indexOf(c.items.map(normU).join('|')) > -1; });
  assertEq(copied.length, 0, s.course + ' no core competency area reproduces a cluster\'s unit list');

  /* Some plan units are already worded as outcomes ("Prepare and produce yeast
     goods"), so a statement may match one verbatim — but if most of them did,
     the column would be a unit list wearing a different heading. */
  const units = t.modules.reduce(function (a, m) { return a.concat(m.topics.map(normU)); }, []);
  const statements = t.competencies.reduce(function (a, c) { return a.concat(c.items); }, []);
  const verbatim = statements.filter(function (i) { return units.indexOf(normU(i)) > -1; });
  assert(verbatim.length * 3 <= statements.length,
    s.course + ' most competency statements summarise rather than repeat a unit title (' +
    verbatim.length + ' of ' + statements.length + ')');
  assert(statements.length < units.length,
    s.course + ' the competency profile is shorter than the unit list (' +
    statements.length + ' statements vs ' + units.length + ' units)');
});

/* ---------- 9. End to end with the certificate renderer ---------- */
console.log('End to end with the renderer');
PLANS.concat([{ course: 'Welding L3' }, { course: 'Electrical Installation L3' }]).forEach(function (p) {
  const t = Seed.templateContentFor(p.course);
  const page2 = CT.page2Content(t);
  assertEq(page2.unitHeading, 'CLUSTERS COMPLETED', p.course + ' prints CLUSTERS, not MODULES');
  assertEq(page2.competencies.length, t.competencies.length,
    p.course + ' prints the plan\'s competency profile');
  assert(page2.competencies.every(function (c) { return c.items.length > 0; }),
    p.course + ' every competency area lists competencies');
  assert(page2.competencies.every(function (c) { return c.derived !== true; }),
    p.course + ' competencies come from the plan, not from the cluster fallback');
  assert(page2.competencies.length < page2.modules.length * 2,
    p.course + ' the competency column stays a summary, not a second unit list');
});

/* A course with NO qualification plan still falls back to its own units, so no
   certificate ever goes out with an empty competencies column. */
console.log('Fallback for a course with no plan');
const noPlan = CT.page2Content({
  courseType: 'Short Course',
  modules: [{ name: 'Solar Panel Mounting', contactHours: 40, topics: ['Mount roof rails', 'Torque fixings'] },
            { name: 'Site Survey', contactHours: 20, topics: [] }],
  competencies: []
});
assertEq(noPlan.unitHeading, 'MODULES COMPLETED', 'a short course prints MODULES');
assertEq(noPlan.competencies.length, 2, 'a course with no plan derives one group per module');
assertEq(noPlan.competencies[0].items.length, 2, 'the module topics become the competencies');
assertEq(noPlan.competencies[1].items[0], 'Competent in Site Survey', 'a module with no topics still reads as a competency');
assert(noPlan.competencies.every(function (c) { return c.derived === true; }), 'the fallback marks itself as derived');

/* Hand-entered competencies always win over the fallback. */
const byHand = CT.page2Content({
  courseType: 'Short Course',
  modules: [{ name: 'Solar Panel Mounting', contactHours: 40, topics: ['Mount roof rails'] }],
  competencies: [{ category: 'Installation', items: ['Mounts and commissions a domestic PV array'] }]
});
assertEq(byHand.competencies.length, 1, 'hand-entered competencies are used as they are');
assertEq(byHand.competencies[0].items[0], 'Mounts and commissions a domestic PV array', 'hand-entered wording is untouched');

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
