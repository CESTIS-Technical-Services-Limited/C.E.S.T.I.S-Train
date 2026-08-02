/* Unit tests for CESTISCore.certTemplate and CESTISCore.vcCapacity.
   Run: node tests/cert-vc-core.test.js */
'use strict';

const Core = require('../cestis-core.js');
const CT = Core.certTemplate;
const VC = Core.vcCapacity;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* ======================= CERTIFICATE TEMPLATES ======================= */

/* ---------- 1. Modules vs Clusters by course type ---------- */
console.log('Module / Cluster naming');
assertEq(CT.unitHeading('Full-time'), 'CLUSTERS COMPLETED', 'full-time course uses CLUSTERS');
assertEq(CT.unitHeading('Full Time'), 'CLUSTERS COMPLETED', 'spacing variant recognised');
assertEq(CT.unitHeading('fulltime'), 'CLUSTERS COMPLETED', 'no-space variant recognised');
assertEq(CT.unitHeading('Short Course'), 'MODULES COMPLETED', 'short course uses MODULES');
assertEq(CT.unitHeading(''), 'MODULES COMPLETED', 'unset course type defaults to MODULES');
assertEq(CT.unitHeading(undefined), 'MODULES COMPLETED', 'undefined course type defaults to MODULES');
assertEq(CT.unitLabel('Full-time'), 'Cluster', 'singular label for full-time');
assertEq(CT.unitLabel('Short Course'), 'Module', 'singular label for short course');
assertEq(CT.unitLabelPlural('Full-time'), 'Clusters', 'plural label for full-time');
assertEq(CT.unitLabelPlural('Short Course'), 'Modules', 'plural label for short course');
assert(CT.isFullTime('Full-time') && !CT.isFullTime('Short Course'), 'isFullTime discriminates');

/* ---------- 2. Technical Competencies generated from the course units ---------- */
console.log('Derived competencies');
const modules = [
  { name: 'Install photovoltaic systems', contactHours: 12, topics: ['Site survey', 'Panel mounting', 'Inverter wiring'] },
  { name: 'Attend to breakdowns in hazardous areas', contactHours: 8, topics: ['Isolation', 'Fault finding'] }
];
let derived = CT.deriveCompetencies(modules, [], 'Short Course');
assertEq(derived.length, 2, 'one competency category per unit');
assertEq(derived[0].category, 'Install photovoltaic systems', 'category takes the unit name');
assertEq(derived[0].items.length, 3, 'unit topics become the competencies');
assertEq(derived[0].items[0], 'Site survey', 'topic text preserved');
assert(derived[0].derived === true, 'derived entries are marked as such');

// A unit with no topics still yields a meaningful competency
derived = CT.deriveCompetencies([{ name: 'Workplace safety' }], [], 'Short Course');
assertEq(derived[0].items[0], 'Competent in Workplace safety', 'unit without topics still produces a competency');

// Hand-written competencies always win
const manual = [{ category: 'System Knowledge', items: ['A', 'B'] }];
assertEq(CT.deriveCompetencies(modules, manual, 'Short Course')[0].category, 'System Knowledge', 'manual competencies are not overwritten');
assertEq(CT.deriveCompetencies(modules, manual, 'Short Course').length, 1, 'manual list used verbatim');

// Nothing to derive from
assertEq(CT.deriveCompetencies([], [], 'Short Course').length, 0, 'no units -> no competencies');
assertEq(CT.deriveCompetencies(null, null, 'Short Course').length, 0, 'null-safe');

// Full-time units fall back to the Cluster label
assertEq(CT.deriveCompetencies([{ topics: [] }], [], 'Full-time')[0].category, 'Cluster 1', 'unnamed full-time unit labelled Cluster');
assertEq(CT.deriveCompetencies([{ topics: [] }], [], 'Short Course')[0].category, 'Module 1', 'unnamed short-course unit labelled Module');

/* ---------- 3. page2Content ties it together ---------- */
console.log('page2Content');
let p2 = CT.page2Content({ courseType: 'Full-time', modules: modules, competencies: [] });
assertEq(p2.unitHeading, 'CLUSTERS COMPLETED', 'heading follows course type');
assertEq(p2.competencies.length, 2, 'competencies derived when none entered');
p2 = CT.page2Content({ courseType: 'Short Course', modules: modules, competencies: manual });
assertEq(p2.unitHeading, 'MODULES COMPLETED', 'short course heading');
assertEq(p2.competencies.length, 1, 'manual competencies preserved');
assert(!!CT.page2Content(null), 'null template does not throw');

/* ---------- 4. New templates inherit the first template's design ---------- */
console.log('Template inheritance');
const base = {
  courseFullName: 'Photovoltaic Installer',
  courseType: 'Short Course',
  programmeCode: 'CESTIS-SOLAR-02',
  version: '1.0',
  developedDate: '13 August 2025',
  bgPage1: 'data:image/png;base64,PAGE1',
  bgPage2: 'data:image/png;base64,PAGE2',
  signatureLeft: 'Programme Coordinator/ Principal',
  signatureRight: 'Chairman of CMC Board',
  contactEmail: 'cestisadmn@gmail.com',
  contactPhone: '+(876) 679-0111',
  textPositions: { p1NameX: 52, p1NameY: 49, p1NameSize: 59, p2TitleX: 50, p2TitleY: 6 },
  bodyText: { completionLine: 'has successfully completed', dateLine: 'on this day, the {date}, at the', instituteLine: 'Community Educational and Skills Training Institute and Services Ltd.' },
  programmeSpecs: { duration: '40 Contact Hours', industry: 'Electro Technology' },
  modules: modules,
  competencies: manual,
  createdAt: '2026-01-01T00:00:00.000Z'
};

const fresh = CT.newFromBase(base, 'Welding L2');
assertEq(fresh.courseFullName, 'Welding L2', 'new template takes the new course name');
assertEq(fresh.bgPage1, 'data:image/png;base64,PAGE1', 'page 1 background inherited');
assertEq(fresh.bgPage2, 'data:image/png;base64,PAGE2', 'page 2 background inherited');
assertEq(fresh.textPositions.p1NameSize, 59, 'text positions and sizes inherited');
assertEq(fresh.bodyText.dateLine, 'on this day, the {date}, at the', 'body wording inherited');
assertEq(fresh.signatureRight, 'Chairman of CMC Board', 'signature titles inherited');
assertEq(fresh.contactPhone, '+(876) 679-0111', 'contact details inherited');
assertEq(fresh.modules.length, 0, 'course content NOT inherited — modules start empty');
assertEq(fresh.competencies.length, 0, 'course content NOT inherited — competencies start empty');
assertEq(fresh.programmeCode, '', 'programme code NOT inherited');
assert(fresh.inheritedFromBase === true, 'new template flagged as inherited');

// Editing the new template must not corrupt the base (deep copy)
fresh.textPositions.p1NameSize = 10;
assertEq(base.textPositions.p1NameSize, 59, 'base template untouched by edits to the copy');

/* ---------- 5. Base template selection ---------- */
console.log('Base template selection');
const templates = {
  'Photovoltaic Installer': base,
  'Welding L2': { courseFullName: 'Welding L2', createdAt: '2026-05-01T00:00:00.000Z' },
  'Cosmetology L2': { courseFullName: 'Cosmetology L2', createdAt: '2026-06-01T00:00:00.000Z' }
};
assertEq(CT.pickBaseKey(templates), 'Photovoltaic Installer', 'earliest created template is the base');
assertEq(CT.pickBaseKey(templates, 'Welding L2'), 'Welding L2', 'an explicit choice wins');
assertEq(CT.pickBaseKey({}), null, 'no templates -> no base');
assertEq(CT.pickBaseKey(null), null, 'null-safe');
const marked = { A: { createdAt: '2026-09-01' }, B: { createdAt: '2026-01-01', isBaseTemplate: true } };
assertEq(CT.pickBaseKey(marked), 'B', 'an explicitly marked base wins over creation order');
// Falls back to whichever template actually has a background set up
assertEq(CT.pickBaseKey({ X: { courseFullName: 'X' }, Y: { bgPage1: 'img' } }), 'Y', 'falls back to a template with a background');

/* ---------- 6. Applying the design to every template ---------- */
console.log('Apply design to all');
const res = CT.applyLookToAll(templates);
assertEq(res.baseKey, 'Photovoltaic Installer', 'base identified');
assertEq(res.changed.length, 2, 'the two other templates changed');
assertEq(res.templates['Welding L2'].bgPage1, 'data:image/png;base64,PAGE1', 'background pushed to other template');
assertEq(res.templates['Welding L2'].textPositions.p1NameSize, 59, 'positions pushed to other template');
assertEq(res.templates['Welding L2'].contactEmail, 'cestisadmn@gmail.com', 'contact details pushed');
assertEq(res.templates['Welding L2'].courseFullName, 'Welding L2', 'each course keeps its own name');
assertEq(res.templates['Photovoltaic Installer'].modules.length, 2, 'base template content untouched');
// Running it twice changes nothing further
const res2 = CT.applyLookToAll(res.templates);
assertEq(res2.changed.length, 0, 'applying the design again is a no-op');

/* ======================= VIDEO CONFERENCE CAPACITY ======================= */
console.log('Mesh maths');
assertEq(VC.meshConnections(1), 0, 'one person needs no connections');
assertEq(VC.meshConnections(2), 1, 'two people share one connection');
assertEq(VC.meshConnections(8), 28, 'eight people need 28 connections');
assertEq(VC.meshConnections(80), 3160, 'eighty people would need 3,160 connections');
assertEq(VC.meshStreamsPerParticipant(80), 158, 'each participant would handle 158 streams at 80');
assertEq(VC.meshUplinkKbps(80, 400), 31600, 'each participant would need ~31.6 Mbps upstream at 80');
assertEq(VC.meshUplinkKbps(1), 0, 'a lone participant uploads nothing');

console.log('Capacity recommendation');
let rec = VC.recommend(6);
assertEq(rec.mode, 'mesh', 'a small class stays peer-to-peer');
assert(rec.feasible, 'small class is feasible');
rec = VC.recommend(80);
assertEq(rec.mode, 'sfu', 'a class of 80 needs the hosted conference server');
assert(rec.feasible, '80 participants is achievable on the SFU');
assertEq(rec.limit, VC.SFU_MAX, 'limit reported as the SFU maximum');
rec = VC.recommend(500);
assert(!rec.feasible, '500 in one room is not feasible');
assertEq(VC.recommend(12, { audioOnly: true }).mode, 'mesh', 'audio-only stretches the mesh further');
assertEq(VC.recommend(12).mode, 'sfu', 'the same 12 with video needs the SFU');

console.log('Mesh join guard');
let j = VC.canJoinMesh(3);
assert(j.allowed, 'a fourth person may join a small mesh room');
assertEq(j.remaining, VC.MESH_MAX_VIDEO - 3, 'remaining seats reported');
j = VC.canJoinMesh(VC.MESH_MAX_VIDEO);
assert(!j.allowed, 'the mesh room refuses a join once full');
assert(/Large Class/.test(j.reason), 'the refusal points at Large Class mode');
assert(VC.canJoinMesh(10, true).allowed, 'audio-only room still has room at 10');
assert(VC.SFU_MAX >= 80, 'the large-class path covers the 80 the Centre needs');

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
