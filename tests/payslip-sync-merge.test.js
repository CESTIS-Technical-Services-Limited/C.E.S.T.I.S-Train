/* Payroll: the cloud tick no longer reverts an edit or brings a deletion back,
   and no cloud path replaces accounts or another device's work.

   1. THE 60-SECOND TICK REVERTED EVERY EDIT. Before each automatic upload the
      page folded the cloud copy in with "the incoming copy wins every
      non-blank field". The cloud only holds what the previous tick pushed, so
      John Brown's salary corrected from 120,000 to 135,000 was back at 120,000
      within a minute — and 120,000 was uploaded. An employee deleted in June
      came back with their payroll results on the next tick. (finance-05)

   2. SYNC FROM CLOUD REPLACED ACCOUNTS AND GRANTS while its confirmation said
      local records were preserved — an account or grant made here was erased,
      a password changed here reverted. (finance-24)

   3. THE MANUAL "SAVE TO CLOUD" UPLOADED WITHOUT MERGING, removing every run,
      employee, account and grant another device had saved since this one
      last merged. And the close-of-page beacon could never update Drive (a
      beacon only POSTs) while putting the Google token in a URL.

   4. AN IDLE MINUTE UPLOADED THE WHOLE PAYROLL, pretty-printed. (finance-27)

   Driven through the page's real functions, extracted from the file.

   Run: node tests/payslip-sync-merge.test.js [page] */
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
const PAGES = process.argv[2] ? [process.argv[2]] : [path.join(ROOT, 'Staff.Payslip.html')];
let SRC = '', PAGE = '';

function extractFunction(name) {
  let at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) at = SRC.indexOf('\nasync function ' + name + '(');
  if (at < 0) throw new Error(PAGE + ' no longer defines ' + name);
  let depth = 0, i = SRC.indexOf('{', at);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(at, i + 1);
}

const FNS = ['_psKeyEmp', '_psKeyRun', '_psKeyRes', '_psStamp', '_psRecordDeleted', '_psStampOf', '_psBlank', '_psFold',
  '_mergeDataIntoLocal', '_dataHash', 'saveStore', '_isSuspiciousDataLoss', '_getHighWaterMark', '_updateHighWaterMark',
  '_backupBeforeSave', 'deleteEmployee', 'deletePayrollEntry', '_mergeCloudUsersAndPerms', 'pyMergeUser2FA',
  'loadUsers', 'saveUsers', 'loadPermissions', 'savePermissions', '_peekMergeCloud', '_psCloudContentHash',
  'autoSaveUsersToCloud', 'saveToCloud', 'syncFromCloud'];

function makePage(opts) {
  const backing = Object.assign({}, opts.store || {});
  const store = {
    getItem: k => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); }, removeItem: k => { delete backing[k]; }
  };
  let cloud = JSON.parse(JSON.stringify(opts.cloud));
  const uploads = [];
  const sb = {
    CESTISCore: Core, CESTISStore: store, DATA: opts.data, STORAGE_KEY: 'cestisPayroll',
    BACKUP_STORAGE_KEY: 'cestisPayroll_backup', HIGH_WATER_KEY: 'cestisPayroll_hw', USERS_KEY: 'payslipUsers',
    PERMS_KEY: 'payslipPerms', _dataDirty: false, _lastSaveHash: null, _psSyncIndex: null, _psLastCloudPushHash: null,
    users: [], currentPageName: 'dashboard', currentUser: { displayName: 'Officer', role: 'admin' }, isCloudConnected: true, googleAccessToken: 'tok',
    cloudFileId: 'PAYFILE', lastSyncTime: null, lastSavedBy: null, cloudFileTimestamp: null,
    GOOGLE_DRIVE_CONFIG: { BACKUP_FILE_NAME: 'p.json', FOLDER_ID: 'F' },
    console: { log() {}, warn() {}, error(...a) { if (process.env.DBG) console.error(...a); } },
    confirm: () => true, alert() {}, Date, Object, Array, String, JSON, Map, Math, Promise, Error, isNaN, parseFloat
  };
  sb.window = sb;
  const noop = () => {};
  ['setCloudSyncing', 'updateLastSyncDisplay', 'updateLastSavedByDisplay', 'renderDashboard', 'renderEmployees',
   'refreshActiveSections', 'renderPayrollInput', 'markDataDirty', 'findExistingBackupFile', 'renderUserManagement',
   'renderPermissions'].forEach(n => { sb[n] = noop; });
  sb.checkPayrollPermission = () => true;
  sb.fmt = n => String(n);
  sb.getDefaultUsers = () => [{ username: 'cestisadmin', displayName: 'Admin', role: 'admin', password: 'x' }];
  sb.checkCloudForChanges = async () => null;
  sb.document = { getElementById: () => ({ classList: { remove() {} } }) };
  sb.fetch = async (url, init) => {
    if (init && (init.method === 'PATCH' || init.method === 'POST')) {
      const body = String(init.body);
      const json = body.slice(body.lastIndexOf('application/json\r\n\r\n') + 20, body.lastIndexOf('\r\n--'));
      const parsed = JSON.parse(json);
      uploads.push({ parsed, raw: json });
      cloud = parsed;
      return { ok: true, status: 200, json: async () => ({ id: 'PAYFILE', parents: ['F'] }) };
    }
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(cloud)) };
  };
  vm.createContext(sb);
  vm.runInContext(FNS.map(extractFunction).join('\n\n'), sb);
  sb._psStamp(true);   // the baseline the page takes when it loads
  sb._backing = backing;
  sb._uploads = uploads;
  return sb;
}

const emp = (name, salary) => ({ name, salary, designation: 'Officer', type: 'FT' });
const run = (date, results) => ({ date, results });
const res = (empName, gross) => ({ empName, gross, netPay: gross * 0.8 });

async function runFor(file) {
  SRC = fs.readFileSync(file, 'utf8');
  PAGE = path.relative(ROOT, file);
  console.log('\n=== ' + PAGE + ' ===');

  console.log('A salary corrected here survives the 60-second cloud tick, and is what gets uploaded');
  {
    const base = () => ({ settings: { nis: 3 }, employees: [emp('John Brown', 120000)], payrollRuns: [run('2026-10-31', [res('John Brown', 120000)])] });
    const pg = makePage({ data: base(), cloud: { version: '1.1', data: base() } });
    pg.DATA.employees[0].salary = 135000;
    pg.DATA.payrollRuns[0].results[0].gross = 135000;
    pg.saveStore();
    await pg.autoSaveUsersToCloud();
    assert(pg.DATA.employees[0].salary === 135000, PAGE + ': salary still 135,000 in memory (got ' + pg.DATA.employees[0].salary + ')');
    assert(JSON.parse(pg._backing.cestisPayroll).employees[0].salary === 135000, PAGE + ': and in storage');
    const up = pg._uploads[0];
    assert(up && up.parsed.data.employees[0].salary === 135000 && up.parsed.data.payrollRuns[0].results[0].gross === 135000,
      PAGE + ': and the upload carries 135,000');
    assert(up && up.raw.indexOf('\n') === -1, PAGE + ': the upload is compact JSON');
    // An idle minute uploads nothing.
    await pg.autoSaveUsersToCloud();
    assert(pg._uploads.length === 1, PAGE + ': an idle tick uploads nothing (uploads: ' + pg._uploads.length + ')');
  }

  console.log('An edit made on another device arrives, and a newer local edit is not overwritten by it');
  {
    const base = () => ({ settings: {}, employees: [emp('Mary Grant', 90000)], payrollRuns: [] });
    const cloudData = base(); cloudData.employees[0].salary = 95000; cloudData.employees[0].updatedAt = '2026-10-20T09:00:00.000Z';
    const pg = makePage({ data: base(), cloud: { version: '1.1', data: cloudData } });
    const s = pg._mergeDataIntoLocal(JSON.parse(JSON.stringify(cloudData)));
    assert(pg.DATA.employees[0].salary === 95000 && s.updatedEmployees === 1, PAGE + ': the newer cloud salary is taken');
    const older = JSON.parse(JSON.stringify(cloudData)); older.employees[0].salary = 80000; older.employees[0].updatedAt = '2026-10-01T00:00:00.000Z';
    pg._mergeDataIntoLocal(older);
    assert(pg.DATA.employees[0].salary === 95000, PAGE + ': an older copy does not win');
  }

  console.log('A deleted employee and a deleted payroll entry stay deleted');
  {
    const base = () => ({ settings: {}, employees: [emp('John Brown', 120000), emp('Left In June', 60000)],
      payrollRuns: [run('2026-06-30', [res('John Brown', 120000), res('Left In June', 60000)]), run('2026-07-31', [res('John Brown', 120000)])] });
    const pg = makePage({ data: base(), cloud: { version: '1.1', data: base() } });
    pg.deleteEmployee(1);
    pg.deletePayrollEntry(1, 0);   // July's only entry: the run goes too
    pg.saveStore();
    await pg.autoSaveUsersToCloud();
    assert(!pg.DATA.employees.some(e => e.name === 'Left In June'), PAGE + ': the employee is not re-added');
    assert(!pg.DATA.payrollRuns[0].results.some(r => r.empName === 'Left In June'), PAGE + ': nor their June result');
    assert(!pg.DATA.payrollRuns.some(r => r.date === '2026-07-31'), PAGE + ': the deleted July run is not re-added');
    const up = pg._uploads[pg._uploads.length - 1].parsed.data;
    assert(!up.employees.some(e => e.name === 'Left In June') && up.deleted && up.deleted['emp:left in june'],
      PAGE + ': the upload drops the employee and carries the deletion');
    // Another device holding the employee drops it when it merges that upload.
    const other = makePage({ data: base(), cloud: { version: '1.1', data: up } });
    other._mergeDataIntoLocal(JSON.parse(JSON.stringify(up)));
    assert(!other.DATA.employees.some(e => e.name === 'Left In June') && !other.DATA.payrollRuns.some(r => r.date === '2026-07-31'),
      PAGE + ': and the other device drops them too');
  }

  console.log('Sync from Cloud merges accounts and grants; Save to Cloud merges before it uploads');
  {
    const base = () => ({ settings: {}, employees: [emp('John Brown', 1)], payrollRuns: [] });
    const cloudData = base(); cloudData.employees.push(emp('Cloud Only', 2)); cloudData.payrollRuns.push(run('2026-09-30', [res('Cloud Only', 2)]));
    const pg = makePage({ data: base(), cloud: { version: '1.1', data: cloudData,
      users: [{ username: 'cestisadmin', displayName: 'Admin', role: 'admin', password: 'cloudhash' }],
      permissions: [{ id: 'P-cloud', status: 'approved' }] },
      store: { payslipUsers: JSON.stringify([{ username: 'cestisadmin', role: 'admin', password: 'localhash' }, { username: 'newclerk', role: 'viewer', password: 'h' }]),
               payslipPerms: JSON.stringify([{ id: 'P-local', status: 'pending' }]) } });
    await pg.syncFromCloud();
    const u = JSON.parse(pg._backing.payslipUsers);
    assert(u.some(x => x.username === 'newclerk'), PAGE + ': an account made here survives Sync from Cloud');
    assert(u.find(x => x.username === 'cestisadmin').password === 'localhash', PAGE + ': a password changed here is not reverted');
    const perms = JSON.parse(pg._backing.payslipPerms).map(p => p.id).sort().join();
    assert(perms === 'P-cloud,P-local', PAGE + ': grants are united (got ' + perms + ')');

    const pg2 = makePage({ data: base(), cloud: { version: '1.1', data: cloudData, users: [{ username: 'cloudclerk', role: 'viewer' }], permissions: [] } });
    await pg2.saveToCloud();
    const up = pg2._uploads[0] && pg2._uploads[0].parsed;
    assert(up && up.data.employees.some(e => e.name === 'Cloud Only') && up.data.payrollRuns.some(r => r.date === '2026-09-30'),
      PAGE + ': the manual upload still holds the other device\'s employee and run');
    assert(up && up.users.some(x => x.username === 'cloudclerk'), PAGE + ': and its account');
  }

  console.log('No last-second beacon to Drive');
  assert(!/sendBeacon\([^)]*googleapis/.test(SRC) && SRC.indexOf("access_token='+encodeURIComponent(googleAccessToken)") === -1,
    PAGE + ': no sendBeacon to a googleapis upload endpoint, and no token in a URL');
}

(async () => {
  for (const f of PAGES) await runFor(f);
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
