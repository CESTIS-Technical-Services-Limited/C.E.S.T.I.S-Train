/* A new PC's placeholders never replace the Centre's real School Fee records.

   What happened (found by tests/browser/upgrade-no-data-loss.js, Google
   Drive scenario): a brand-new PC signed in after the upgrade. Its dashboard
   had pulled the trainee roll but not yet the fee roll, and its save hook
   (syncStudentsToSchoolFee) minted a PLACEHOLDER fee record for every trainee
   — tuition $0, no ID, no address, no guardian, flagged needsFeeDetails —
   dated now. Every merge after that judged by date: the School Fee page's
   Drive file (CESTIS_School_Fees.json, one whole value, newest write wins),
   the fee page's own backup merge (Core.sync.mergeList) and the master
   snapshot (fill-only, and the roll was no longer empty). So on the new PC all
   41 trainees read $0 tuition with their details blank, while Drive still held
   the real records; the next save from that PC would have sent the
   placeholders back up.

   Pinned here, with the real cestis-core.js and the real functions from
   School.Fee.html and index.html:
     - Core.feeRecordRank: a placeholder is rank 0, a record with anything a
       person typed (or paid) is rank 1;
     - the page-cloud merge of the fee roll is record by record, and a real
       record beats a placeholder whatever the dates, keeping the
       placeholder-only trainees and honouring the fee page's deletion list;
     - the fee page's own Drive merge (feeMergeCloudData) does the same;
     - the master snapshot's reconcile lets the real record take the
       placeholder's place too (it used to keep this device's copy on every
       id clash), and never the other way round;
     - the dashboard's placeholders are rank 0, so they never stand against a
       real record (it still mirrors a trainee into a fee roll this PC does
       not hold yet — the office PC's first enrolment needs that);
     - editing a record on the fee page makes it a real record.

   Run: node tests/fee-placeholder-merge.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const FEE = fs.readFileSync(path.join(ROOT, 'School.Fee.html'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function extractFunction(src, name) {
  const m = new RegExp('function ' + name + '\\(').exec(src);
  if (!m) throw new Error('no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

// The Centre's real record, as the old build and Drive hold it (it also still
// carries the mirror's flag — the old build never cleared it).
const REAL = { id: 'STU-rg', lmsId: 'STU-rg', name: 'Rushane Grant', skillArea: 'WELDING L2', tuitionFee: 30000,
  contact: '876-555-1109', nationalId: 'NID5009', address: '10 Fee Lane', dateOfBirth: '2002-01-10', totalPaid: 11000,
  balance: 19000, needsFeeDetails: true, source: 'lms', createdAt: '2026-04-06T12:00:00.000Z' };
// What the new PC minted for the same trainee, dated now.
const PLACEHOLDER = { id: 'STU-rg', lmsId: 'STU-rg', name: 'Rushane Grant', skillArea: 'Welding & Fabrication', tuitionFee: 0,
  contact: '', nationalId: '', address: '', dateOfBirth: '', city: '', parentName: '', parentContact: '', emergencyContact: '',
  totalPaid: 0, balance: 0, status: 'Outstanding', source: 'lms', needsFeeDetails: true,
  createdAt: '2026-10-21T23:33:41.383Z', updatedAt: '2026-10-21T23:33:58.014Z' };
const OTHER = { id: 'STU-ab', lmsId: 'STU-ab', name: 'Andre Brown', skillArea: 'WELDING L2', tuitionFee: 30000, nationalId: 'NID5000',
  address: '1 Fee Lane', totalPaid: 10500, updatedAt: '2026-05-10T12:00:00.000Z' };
const NEW_HERE = Object.assign({}, PLACEHOLDER, { id: 'STU-new', lmsId: 'STU-new', name: 'Brand New Trainee' });
const clone = o => JSON.parse(JSON.stringify(o));

console.log('A placeholder ranks below a real record');
assertEq(Core.feeRecordRank(PLACEHOLDER), 0, 'the new PC\'s placeholder is rank 0');
assertEq(Core.feeRecordRank(REAL), 1, 'a record with an ID and an address is rank 1, even still flagged needsFeeDetails');
assertEq(Core.feeRecordRank(Object.assign({}, PLACEHOLDER, { totalPaid: 5000 })), 1, 'a record with money paid on it is rank 1');
assertEq(Core.feeRecordRank({ id: 'X', name: 'Made on the fee page', tuitionFee: 0 }), 1, 'a record made on the fee page (no flag) is rank 1');

console.log('The fee page\'s Drive file: the real roll beats the new PC\'s placeholders');
{
  const local = { cestiSchoolFeeStudents: JSON.stringify([clone(PLACEHOLDER), clone(NEW_HERE)]) };
  const localStamps = { cestiSchoolFeeStudents: '2026-10-21T23:33:58.020Z' };
  const cloud = { cestiSchoolFeeStudents: JSON.stringify([clone(REAL), clone(OTHER)]),
    cestiSchoolFeeDeletedLmsIds: JSON.stringify([]) };
  const cloudStamps = { cestiSchoolFeeStudents: '2026-10-21T23:31:14.094Z' };
  const res = Core.pageCloud.mergeKeys(local, localStamps, cloud, cloudStamps,
    { firstSync: false, records: Core.pageCloud.DRIVE_RECORD_KEYS });
  const roll = JSON.parse(res.data.cestiSchoolFeeStudents);
  const rg = roll.find(r => r.id === 'STU-rg');
  assert(res.changed.indexOf('cestiSchoolFeeStudents') !== -1, 'the merge rewrites this PC\'s fee roll');
  assert(rg && rg.tuitionFee === 30000 && rg.nationalId === 'NID5009' && rg.address === '10 Fee Lane' && rg.skillArea === 'WELDING L2' && rg.totalPaid === 11000,
    'Rushane Grant keeps his tuition, ID, address, programme and payments (got ' + JSON.stringify(rg) + ')');
  assert(roll.some(r => r.id === 'STU-ab' && r.nationalId === 'NID5000'), 'a trainee only Drive holds arrives whole');
  assert(roll.some(r => r.id === 'STU-new'), 'a trainee only this PC holds is kept');
  assertEq(roll.length, 3, 'nobody duplicated, nobody dropped');
}
{
  // The same merge on the Centre's own server (every registered key by record).
  const res = Core.pageCloud.mergeKeys({ cestiSchoolFeeStudents: JSON.stringify([clone(PLACEHOLDER)]) },
    { cestiSchoolFeeStudents: '2026-10-21T23:33:58.020Z' }, { cestiSchoolFeeStudents: JSON.stringify([clone(REAL)]) },
    { cestiSchoolFeeStudents: '2026-10-21T23:31:14.094Z' }, { symmetric: true, records: true });
  const rg = JSON.parse(res.data.cestiSchoolFeeStudents)[0];
  assert(rg.nationalId === 'NID5009' && rg.tuitionFee === 30000, 'and on the Centre\'s own server');
}
{
  // A trainee deleted on the fee page is not brought back by the other copy.
  const res = Core.pageCloud.mergeKeys({ cestiSchoolFeeStudents: JSON.stringify([clone(OTHER)]),
    cestiSchoolFeeDeletedLmsIds: JSON.stringify(['STU-rg']) }, { cestiSchoolFeeStudents: '2026-10-21T10:00:00.000Z' },
    { cestiSchoolFeeStudents: JSON.stringify([clone(OTHER), clone(REAL)]) }, { cestiSchoolFeeStudents: '2026-10-21T11:00:00.000Z' },
    { records: Core.pageCloud.DRIVE_RECORD_KEYS });
  const roll = JSON.parse(res.data.cestiSchoolFeeStudents);
  assert(!roll.some(r => r.id === 'STU-rg') && roll.some(r => r.id === 'STU-ab'), 'a trainee on the fee page\'s deletion list stays deleted');
}
{
  // Two real copies: the newer edit still wins, as before.
  const older = Object.assign({}, OTHER, { address: 'Old Address', updatedAt: '2026-05-10T12:00:00.000Z' });
  const newer = Object.assign({}, OTHER, { address: 'New Address', updatedAt: '2026-09-10T12:00:00.000Z' });
  const res = Core.pageCloud.mergeKeys({ cestiSchoolFeeStudents: JSON.stringify([older]) }, { cestiSchoolFeeStudents: '2026-10-21T10:00:00.000Z' },
    { cestiSchoolFeeStudents: JSON.stringify([newer]) }, { cestiSchoolFeeStudents: '2026-10-21T09:00:00.000Z' },
    { records: Core.pageCloud.DRIVE_RECORD_KEYS });
  assertEq(JSON.parse(res.data.cestiSchoolFeeStudents)[0].address, 'New Address', 'between two real copies the newer edit wins');
}

console.log('The fee page\'s own backup merge (feeMergeCloudData) keeps the real record');
{
  const backing = {};
  const store = { getItem: k => (k in backing ? backing[k] : null), setItem: (k, v) => { backing[k] = String(v); }, removeItem: k => { delete backing[k]; } };
  const sb = { CESTISCore: Core, CESTISStore: store, students: [clone(PLACEHOLDER)], payments: [], documents: [], users: [], feeStructure: {},
    console: { log() {}, warn() {}, error() {} }, Date, Object, Array, String, Math, JSON, Map, Set, parseFloat, parseInt, isNaN };
  sb.window = sb;
  vm.createContext(sb);
  const varOf = name => { const m = new RegExp('\\n        var ' + name + ' = [^\\n]*;').exec(FEE); if (!m) throw new Error('School.Fee.html no longer declares ' + name); return m[0]; };
  vm.runInContext([varOf('_feeSyncIndex'), varOf('FEE_DELETED_DOCS'), varOf('FEE_DELETED_KEYS')].concat(
    ['getDeletedPaymentIds', 'unionDeletedPaymentIds', 'filterTombstonedPayments', 'dropTombstonedFeeStudents', 'feeSyncKeyById',
     'feeUserKey', 'feeSyncSets', 'feeSyncStamp', 'feeSyncRebaseline', 'feeTimedTombList', 'feeTimedTombs', 'feeUnionTimedTombs',
     'feeMergeCloudData'].map(n => extractFunction(FEE, n))).join('\n\n'), sb);
  // The placeholder was minted on this PC after its baseline: a fresh edit.
  sb.feeSyncRebaseline();
  sb.students[0].address = '';
  vm.runInContext('feeMergeCloudData({ students: ' + JSON.stringify([REAL]) + ' })', sb);
  const rg = sb.students[0];
  assert(rg.tuitionFee === 30000 && rg.nationalId === 'NID5009' && rg.skillArea === 'WELDING L2', 'the Centre\'s record replaces the placeholder (got ' + JSON.stringify(rg) + ')');
}

console.log('The master snapshot lets the real record take the placeholder\'s place');
{
  const snap = { store: { cestiSchoolFeeStudents: JSON.stringify([REAL, OTHER]) } };
  let res = Core.reconcileSnapshot(snap, { cestiSchoolFeeStudents: JSON.stringify([PLACEHOLDER, NEW_HERE]) });
  const roll = JSON.parse(res.store.cestiSchoolFeeStudents);
  const rg = roll.find(r => r.id === 'STU-rg');
  assert(rg && rg.tuitionFee === 30000 && rg.nationalId === 'NID5009' && rg.address === '10 Fee Lane',
    'the Centre\'s record replaces the new PC\'s placeholder (got ' + JSON.stringify(rg) + ')');
  assertEq(rg && rg.updatedAt, undefined, 'without taking the placeholder\'s date');
  assert(roll.some(r => r.id === 'STU-ab') && roll.some(r => r.id === 'STU-new'), 'the other real record is added and the placeholder-only trainee kept');
  res = Core.reconcileSnapshot({ store: { cestiSchoolFeeStudents: JSON.stringify([PLACEHOLDER]) } }, { cestiSchoolFeeStudents: JSON.stringify([REAL]) });
  assertEq(JSON.parse(res.store.cestiSchoolFeeStudents)[0].tuitionFee, 30000, 'and a placeholder in a snapshot never replaces a real record here');
}

console.log('The dashboard\'s placeholders are rank 0, and it still mirrors a new trainee');
{
  const backing = {};
  const store = { getItem: k => (k in backing ? backing[k] : null), setItem: (k, v) => { backing[k] = String(v); } };
  const sb = { CESTISCore: Core, CESTISStore: store, studentProfiles: {}, localDateStr: () => '2026-10-21',
    students: [{ id: 'STU-rg', name: 'Rushane Grant', course: 'Welding & Fabrication' }], document: { getElementById: () => null },
    console: { log() {}, warn() {} } };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(['function readArr(key){ try { var r = CESTISStore.getItem(key); var a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; } catch(e){ return []; } }',
    extractFunction(INDEX, 'broadcastStudentsToFeeFrames'), extractFunction(INDEX, 'syncStudentsToSchoolFee')].join('\n'), sb);
  vm.runInContext('syncStudentsToSchoolFee()', sb);
  const minted = JSON.parse(backing.cestiSchoolFeeStudents || '[]');
  assertEq(minted.length, 1, 'a PC with no fee roll yet mirrors the trainee in');
  assertEq(Core.feeRecordRank(minted[0]), 0, 'as a placeholder, which any real record outranks');
  backing.cestiSchoolFeeStudents = JSON.stringify([REAL]);
  vm.runInContext('syncStudentsToSchoolFee()', sb);
  const roll = JSON.parse(backing.cestiSchoolFeeStudents);
  assert(roll.length === 1 && roll[0].nationalId === 'NID5009', 'and links an existing record instead of minting a second one');
}

console.log('Editing a record on the fee page makes it a real record');
{
  const fn = extractFunction(FEE, 'saveStudentEdit');
  assert(/delete student\.needsFeeDetails;/.test(fn), 'saveStudentEdit clears the placeholder flag');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
