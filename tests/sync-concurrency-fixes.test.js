/* Two fixes from the shared-data stress audit (Nov 2026), pinned here.

   1. School Fee payments merge payment by payment. Two offices took a payment
      within the same minute; each PC wrote its whole payment list to the
      page's Drive file, the later list replaced the earlier, and the pull
      then wrote that list over the first PC's own copy. One payment was gone
      everywhere. Now both payments survive, a deleted payment stays deleted,
      and the newer edit of the same payment wins.

   2. A trainee's save no longer deletes the attendance register (and the
      invigilators' registers, and other trainees' assessment work) from the
      Centre's shared copy. A trainee's device leaves these out of what it
      sends; the upload replaces the whole file, so leaving a key out was a
      deletion. They are now carried forward exactly as last read.

   Run: node tests/sync-concurrency-fixes.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function extract(src, re) {
  const m = re.exec(src);
  if (!m) throw new Error('index.html no longer matches ' + re);
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces');
}

console.log('School Fee payments merge payment by payment');
const PAY_A = { id: 'PAY1730890000001', lmsId: 'STU-a', amount: 5000, createdAt: '2026-11-06T10:00:00.000Z' };
const PAY_B = { id: 'PAY1730890020002', lmsId: 'STU-b', amount: 7500, createdAt: '2026-11-06T10:00:20.000Z' };
const merge = (local, ls, cloud, cs, opts) => Core.pageCloud.mergeKeys(local, ls, cloud, cs, opts || { records: Core.pageCloud.DRIVE_RECORD_KEYS });
{
  // Office 1 took payment A; office 2 took payment B 20 s later and wrote first.
  const res = merge({ cestiSchoolFeePayments: JSON.stringify([PAY_A]) }, { cestiSchoolFeePayments: '2026-11-06T10:00:00.000Z' },
    { cestiSchoolFeePayments: JSON.stringify([PAY_B]) }, { cestiSchoolFeePayments: '2026-11-06T10:00:20.000Z' });
  const ids = JSON.parse(res.data.cestiSchoolFeePayments).map(p => p.id).sort();
  assert(ids.length === 2 && ids[0] === PAY_A.id && ids[1] === PAY_B.id, 'both offices\' payments are kept (got ' + ids + ')');
}
{
  // The same on the Centre's own server.
  const res = merge({ cestiSchoolFeePayments: JSON.stringify([PAY_A]) }, { cestiSchoolFeePayments: '2026-11-06T10:00:00.000Z' },
    { cestiSchoolFeePayments: JSON.stringify([PAY_B]) }, { cestiSchoolFeePayments: '2026-11-06T10:00:20.000Z' }, { symmetric: true, records: true });
  assert(JSON.parse(res.data.cestiSchoolFeePayments).length === 2, 'and on the Centre\'s own server');
}
{
  // A payment deleted on this PC is not brought back by the other copy.
  const res = merge({ cestiSchoolFeePayments: JSON.stringify([PAY_B]), cestiSchoolFeeDeletedPaymentIds: JSON.stringify([PAY_A.id]) },
    { cestiSchoolFeePayments: '2026-11-06T11:00:00.000Z' },
    { cestiSchoolFeePayments: JSON.stringify([PAY_A, PAY_B]) }, { cestiSchoolFeePayments: '2026-11-06T10:30:00.000Z' });
  const ids = JSON.parse(res.data.cestiSchoolFeePayments).map(p => p.id);
  assert(ids.length === 1 && ids[0] === PAY_B.id, 'a deleted payment stays deleted (got ' + ids + ')');
}
{
  // A deletion made on the OTHER PC travels in the same file and is honoured here.
  const res = merge({ cestiSchoolFeePayments: JSON.stringify([PAY_A, PAY_B]) }, { cestiSchoolFeePayments: '2026-11-06T10:00:30.000Z' },
    { cestiSchoolFeePayments: JSON.stringify([PAY_B]), cestiSchoolFeeDeletedPaymentIds: JSON.stringify([PAY_A.id]) },
    { cestiSchoolFeePayments: '2026-11-06T10:40:00.000Z' });
  const ids = JSON.parse(res.data.cestiSchoolFeePayments).map(p => p.id);
  assert(ids.length === 1 && ids[0] === PAY_B.id, 'a payment deleted on the other PC is removed here too (got ' + ids + ')');
}
{
  // Two edits of the same payment: the newer one wins, nothing is duplicated.
  const older = Object.assign({}, PAY_A, { amount: 5000, updatedAt: '2026-11-06T10:05:00.000Z' });
  const newer = Object.assign({}, PAY_A, { amount: 5500, updatedAt: '2026-11-06T10:09:00.000Z' });
  const res = merge({ cestiSchoolFeePayments: JSON.stringify([newer]) }, { cestiSchoolFeePayments: '2026-11-06T10:09:00.000Z' },
    { cestiSchoolFeePayments: JSON.stringify([older]) }, { cestiSchoolFeePayments: '2026-11-06T10:10:00.000Z' });
  const list = JSON.parse(res.data.cestiSchoolFeePayments);
  assert(list.length === 1 && list[0].amount === 5500, 'the newer edit of one payment wins (got ' + JSON.stringify(list) + ')');
}
assert(Core.pageCloud.DRIVE_RECORD_KEYS.indexOf('cestiSchoolFeePayments') !== -1, 'payments merge record by record on the Drive path');

console.log('A trainee\'s save keeps the register in the Centre\'s shared copy');
{
  const sandbox = {};
  vm.createContext(sandbox);
  const keysLine = /var CLOUD_ADMIN_SLICE_KEYS = \[[\s\S]*?\];/.exec(INDEX);
  assert(!!keysLine, 'index.html still lists the carried-forward keys');
  vm.runInContext('var _cloudAdminSlices = {};\n' + keysLine[0] + '\n' +
    extract(INDEX, /function rememberCloudAdminSlices\(/) + '\n' +
    extract(INDEX, /function carryForwardCloudAdminSlices\(/), sandbox);
  ['attendanceRegister', 'examRegisters', 'assessmentWork'].forEach(k =>
    assert(vm.runInContext('CLOUD_ADMIN_SLICE_KEYS', sandbox).indexOf(k) !== -1, k + ' is carried forward'));

  const register = { '2026-11-06': { 'STU-a': 'P', 'STU-b': 'A' } };
  const examRegs = [{ id: 'ER1', examId: 'E1' }];
  sandbox.lastRead = { attendanceRegister: register, examRegisters: examRegs, assessmentWork: [{ id: 'W1' }] };
  vm.runInContext('rememberCloudAdminSlices(lastRead)', sandbox);

  // A trainee's payload: none of these keys.
  sandbox.payload = { students: [] };
  vm.runInContext('carryForwardCloudAdminSlices(payload)', sandbox);
  const p = sandbox.payload;
  assert(p.attendanceRegister && p.attendanceRegister['2026-11-06'] && p.attendanceRegister['2026-11-06']['STU-b'] === 'A',
    'the attendance register goes back up as last read');
  assert(Array.isArray(p.examRegisters) && p.examRegisters.length === 1, 'the invigilators\' registers go back up');

  // An instructor's own (newer) register is never replaced by the last-read copy.
  const mine = { '2026-11-06': { 'STU-a': 'P', 'STU-b': 'P', 'STU-c': 'L' } };
  sandbox.payload2 = { attendanceRegister: mine };
  vm.runInContext('carryForwardCloudAdminSlices(payload2)', sandbox);
  assert(sandbox.payload2.attendanceRegister === mine, 'a device\'s own register is sent as it is');
}

console.log((failed ? '✗' : '✓') + ' ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
