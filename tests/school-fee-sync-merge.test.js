/* School Fee: syncing from the cloud merges — it never throws a payment away.

   Four faults, each of which lost or reverted money records:

   1. CONNECT / SIGN-IN "SYNC NOW" REPLACED EVERYTHING. Connect to Drive, the
      "Sync Now" offered at sign-in, Sync from Cloud and the selective sync all
      did `payments = backupData.data.payments` (and the same for trainees,
      documents, the fee structure and accounts). Uploads stop when the Google
      token expires, so a payment taken in that window existed only here — and
      pressing Sync erased it while the trainee held the printed receipt, and
      their balance went back up.

   2. THE 15-SECOND AUTO-SYNC LET THIS DEVICE WIN EVERY RECORD. A payment
      corrected from $10,000 to $12,000 on one PC was put back to $10,000 by any
      PC that had not caught up, and uploaded again, every 15 seconds.

   3. A DELETED TRAINEE CAME BACK. deleteStudent dropped the trainee's payments
      without writing their deletion down, and the auto-sync started from the
      cloud's trainee list without honouring the trainee tombstones — so the
      trainee and their receipt were back 15 seconds later.

   4. A DELETED (OR RENAMED) PROGRAMME CAME BACK from the cloud's fee structure.

   Each is driven through the page's real functions, extracted from the file.

   Run: node tests/school-fee-sync-merge.test.js [page] */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const ROOT = path.join(__dirname, '..');
// The Offline System copy is regenerated from this page by the offline build.
const PAGES = process.argv[2] ? [process.argv[2]] : [path.join(ROOT, 'School.Fee.html')];
let SRC = '', PAGE = '';

function extractFunction(name) {
  let at = SRC.indexOf('\n        function ' + name + '(');
  if (at < 0) at = SRC.indexOf('\n        async function ' + name + '(');
  if (at < 0) throw new Error(PAGE + ' no longer defines ' + name);
  let depth = 0, i = SRC.indexOf('{', at);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(at, i + 1);
}
function extractVar(name) {
  const m = new RegExp('\\n        var ' + name + ' = [^\\n]*;').exec(SRC);
  if (!m) throw new Error(PAGE + ' no longer declares ' + name);
  return m[0];
}

const FNS = ['getDeletedPaymentIds', 'recordDeletedPaymentId', 'unionDeletedPaymentIds', 'filterTombstonedPayments',
  'dropTombstonedFeeStudents', 'feeSyncKeyById', 'feeUserKey', 'feeSyncSets', 'feeSyncStamp', 'feeSyncRebaseline',
  'feeTimedTombList', 'feeTimedTombs', 'feeRecordTimedTomb', 'feeUnionTimedTombs', 'feeTombstonePayload',
  'feeMergeCloudData', 'feeApplyCloudBackup', 'recalculateStudentTotals', 'saveData', 'saveUsers',
  'saveFeeStructure', 'deleteStudent', 'deleteFee', 'performForcedSyncAfterConnect', 'performAutoSyncCycle',
  'performAutoSyncOnLogin', 'syncFromCloud'];

function makePage(opts) {
  const backing = Object.assign({}, opts.store || {});
  const store = {
    getItem: k => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: k => { delete backing[k]; }
  };
  const uploads = [];
  const sb = {
    CESTISCore: Core, CESTISStore: store,
    students: opts.students || [], payments: opts.payments || [], documents: opts.documents || [],
    users: opts.users || [], feeStructure: opts.feeStructure || {},
    currentUser: { username: 'clerk', role: 'Admin' },
    cloudFileId: 'FILE1', googleAccessToken: 'tok', isCloudConnected: true, isAutoSyncing: false,
    lastSyncTime: null, lastSavedBy: null, cloudFileTimestamp: null, autoSyncSecondsRemaining: 15,
    AUTO_SYNC_INTERVAL_MS: 15000, GOOGLE_DRIVE_CONFIG: { BACKUP_FILE_NAME: 'x', FOLDER_ID: 'y' },
    navigator: { onLine: true },
    console: { log() {}, warn() {}, error(...a) { if (process.env.DBG) console.error(...a); } },
    confirm: () => true, alert() {},
    document: { getElementById: id => (id === 'cloudDropdownMenu' ? { classList: { remove() {}, add() {} } } : null), querySelector: () => null },
    _feeStabilizing: false,
    Blob, Date, Object, Array, String, Math, JSON, Map, Set, parseFloat, parseInt, isNaN, Promise, Error
  };
  sb.window = sb;
  const noop = () => {};
  ['setCloudSyncing', 'updateCloudUI', 'updateLastSyncDisplay', 'updateLastSavedByDisplay', 'renderFeeStructure',
   'renderStudentsTable', 'renderPaymentsTable', 'renderDocumentsTable', 'renderUsersTable',
   'populatePaymentStudentSelect', 'populateDocumentStudentSelect', 'updateSkillAreaOptions', 'updateDashboard',
   'closeForcedSyncModal', 'showNotification', 'updateAutoSyncCountdown', 'stopAutoSync', 'dedupeFeeStructure',
   'collapseFeeIntakes', 'feeInvalidateCaches', 'syncStudentsToProgressDashboard', 'broadcastStudentsToParent',
   'stabilizeFeeStudentIds', 'feeDeclineCarry', 'findExistingBackupFile', 'populateDocumentStudentSelect'
  ].forEach(n => { sb[n] = noop; });
  sb.feePaymentStatus = s => (s.balance <= 0 ? 'Fully Paid' : 'Owing');
  sb.feeNameKey = n => String(n || '').toLowerCase();
  sb.feePersist = (k, v) => { backing[k] = JSON.stringify(v); return true; };
  sb.fetch = async (url, init) => {
    if (init && (init.method === 'PATCH' || init.method === 'POST')) {
      uploads.push(JSON.parse(await init.body.text()));
      return { ok: true, json: async () => ({ id: 'FILE1' }) };
    }
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(opts.cloud)) };
  };
  vm.createContext(sb);
  vm.runInContext([extractVar('_feeSyncIndex'), extractVar('FEE_DELETED_DOCS'), extractVar('FEE_DELETED_KEYS')]
    .concat(FNS.map(extractFunction)).join('\n\n'), sb);
  // The page takes its baseline when it loads.
  sb.feeSyncRebaseline();
  sb._backing = backing;
  sb._uploads = uploads;
  return sb;
}
const ids = list => list.map(r => r.id).sort().join(',');
const backup = data => ({ version: '1.0', timestamp: '2026-10-20T10:00:00.000Z', data });

async function runFor(file) {
  SRC = fs.readFileSync(file, 'utf8');
  PAGE = path.relative(ROOT, file);
  console.log('\n=== ' + PAGE + ' ===');

  const kerry = { id: 'S1', name: 'Kerry-Ann Smith', tuitionFee: 35000, updatedAt: '2026-09-01T00:00:00.000Z' };
  const p1 = { id: 'R-0001', studentId: 'S1', amount: 10000 };
  const p2 = { id: 'R-0002', studentId: 'S1', amount: 15000 };

  /* ---------- 1. Connect / Sync Now merge ---------- */
  console.log('Connect\'s "Sync Now" keeps a payment taken while uploads were stopped');
  for (const fn of ['performForcedSyncAfterConnect', 'performAutoSyncOnLogin', 'syncFromCloud']) {
    const pg = makePage({
      students: [Object.assign({}, kerry)], payments: [Object.assign({}, p1), Object.assign({}, p2)],
      cloud: backup({ students: [Object.assign({}, kerry)], payments: [Object.assign({}, p1)], users: [], documents: [] }),
      store: { cestisGoogleAccessToken: 'tok' }
    });
    await pg[fn]();
    const stored = JSON.parse(pg._backing.cestiSchoolFeePayments || '[]');
    assert(ids(pg.payments) === 'R-0001,R-0002', PAGE + ' ' + fn + ': R-0002 is still in memory (got ' + ids(pg.payments) + ')');
    assert(ids(stored) === 'R-0001,R-0002', PAGE + ' ' + fn + ': and in storage');
    assert(pg.students[0].totalPaid === 25000 && pg.students[0].balance === 10000,
      PAGE + ' ' + fn + ': the balance still counts it (paid ' + pg.students[0].totalPaid + ')');
  }

  console.log('A cloud-only payment and an account made here both survive the merge');
  {
    const pg = makePage({
      students: [Object.assign({}, kerry)], payments: [Object.assign({}, p1)],
      users: [{ id: 'U9', username: 'newclerk', role: 'Clerk' }],
      cloud: backup({ students: [Object.assign({}, kerry)], payments: [Object.assign({}, p1), Object.assign({}, p2)],
                      users: [{ id: 'ADMIN001', username: 'Cestisadmin', role: 'Admin' }] })
    });
    await pg.performForcedSyncAfterConnect();
    assert(ids(pg.payments) === 'R-0001,R-0002', PAGE + ': the other device\'s payment arrives');
    const names = pg.users.map(u => u.username).sort().join(',');
    assert(names === 'Cestisadmin,newclerk', PAGE + ': an account created here is not replaced away (got ' + names + ')');
  }

  /* ---------- 2. Newer edit wins ---------- */
  console.log('A payment corrected on another PC reaches this one, and is not uploaded back');
  {
    const pg = makePage({
      students: [Object.assign({}, kerry)], payments: [Object.assign({}, p1)],
      cloud: backup({ students: [Object.assign({}, kerry)],
                      payments: [Object.assign({}, p1, { amount: 12000, updatedAt: '2026-10-20T09:00:00.000Z' })] })
    });
    await pg.performAutoSyncCycle();
    assert(pg.payments[0].amount === 12000, PAGE + ': the newer amount is taken (got ' + pg.payments[0].amount + ')');
    const up = pg._uploads[pg._uploads.length - 1];
    assert(!up || up.data.payments[0].amount === 12000, PAGE + ': and anything uploaded carries 12000, not the stale 10000');
  }
  console.log('A correction made HERE wins over the older cloud copy');
  {
    const pg = makePage({
      students: [Object.assign({}, kerry)], payments: [Object.assign({}, p1)],
      cloud: backup({ students: [Object.assign({}, kerry)], payments: [Object.assign({}, p1)] })
    });
    pg.payments[0].amount = 11000;   // edited on this device
    pg.saveData();                   // ...and saved: dated now
    assert(!!pg.payments[0].updatedAt, PAGE + ': saving an edited payment dates it');
    await pg.performAutoSyncCycle();
    assert(pg.payments[0].amount === 11000, PAGE + ': the edit survives the auto-sync');
    const up = pg._uploads[pg._uploads.length - 1];
    assert(up && up.data.payments[0].amount === 11000, PAGE + ': and is uploaded');
  }
  console.log('Nothing to upload when the cloud already holds the same records');
  {
    const pg = makePage({
      students: [Object.assign({}, kerry)], payments: [Object.assign({}, p1)], feeStructure: {},
      cloud: backup({ students: [Object.assign({}, kerry)], payments: [Object.assign({}, p1)], users: [], documents: [],
                      feeStructure: {}, deletedPaymentIds: [], deletedDocumentIds: [], deletedFeeKeys: [] })
    });
    await pg.performAutoSyncCycle();
    assert(pg._uploads.length === 0, PAGE + ': no upload (got ' + pg._uploads.length + ')');
  }

  /* ---------- 3. Deleted trainee stays deleted ---------- */
  console.log('A deleted trainee and their payment stay deleted after the next auto-sync');
  {
    const dup = { id: 'S2', name: 'Duplicate Entry', tuitionFee: 35000 };
    const p3 = { id: 'R-0003', studentId: 'S2', amount: 5000 };
    const pg = makePage({
      students: [Object.assign({}, kerry), Object.assign({}, dup)], payments: [Object.assign({}, p1), Object.assign({}, p3)],
      cloud: backup({ students: [Object.assign({}, kerry), Object.assign({}, dup)], payments: [Object.assign({}, p1), Object.assign({}, p3)] })
    });
    pg.CESTISCore = Object.assign({}, Core, { recordDeletedStudent: (id, st) => {
      const l = JSON.parse(st.getItem('voctrain_deletedStudentIds') || '[]'); l.push(id); st.setItem('voctrain_deletedStudentIds', JSON.stringify(l));
    } });
    pg.deleteStudent(1);
    await pg.performAutoSyncCycle();
    assert(ids(pg.students) === 'S1', PAGE + ': the trainee is not back (got ' + ids(pg.students) + ')');
    assert(ids(pg.payments) === 'R-0001', PAGE + ': nor their receipt (got ' + ids(pg.payments) + ')');
    const up = pg._uploads[pg._uploads.length - 1];
    assert(up && ids(up.data.payments) === 'R-0001' && up.data.deletedPaymentIds.indexOf('R-0003') !== -1,
      PAGE + ': the upload drops the receipt and carries its deletion');
  }

  /* ---------- 4. Deleted programme stays deleted ---------- */
  console.log('A deleted programme is not brought back by the cloud fee structure');
  {
    const fs0 = { 'WELDING L2': { total: 28000, terms: [] }, 'OLD PROGRAMME': { total: 1000, terms: [] } };
    const pg = makePage({ feeStructure: JSON.parse(JSON.stringify(fs0)),
      cloud: backup({ students: [], payments: [], feeStructure: JSON.parse(JSON.stringify(fs0)) }) });
    pg.deleteFee('OLD PROGRAMME');
    await pg.performAutoSyncCycle();
    assert(!pg.feeStructure['OLD PROGRAMME'], PAGE + ': OLD PROGRAMME stays deleted');
    assert(!!pg.feeStructure['WELDING L2'], PAGE + ': the others are untouched');
    const up = pg._uploads[pg._uploads.length - 1];
    assert(up && !up.data.feeStructure['OLD PROGRAMME'] && up.data.deletedFeeKeys.some(e => e.indexOf('OLD PROGRAMME|') === 0),
      PAGE + ': the upload carries the deletion, so other devices drop it too');
    // ...and another device that receives the deletion drops its copy.
    const other = makePage({ feeStructure: JSON.parse(JSON.stringify(fs0)), cloud: up });
    await other.performAutoSyncCycle();
    assert(!other.feeStructure['OLD PROGRAMME'], PAGE + ': the other device drops it on its next sync');
  }

  console.log('The sync paths no longer replace collections wholesale');
  ['payments = backupData.data.payments', 'students = backupData.data.students', 'users = backupData.data.users',
   'documents = backupData.data.documents', 'feeStructure = backupData.data.feeStructure', 'users = backup.data.users'].forEach(s => {
    assert(SRC.indexOf(s) === -1, PAGE + ': no "' + s + '" left');
  });
}

(async () => {
  for (const f of PAGES) await runFor(f);
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
