/* The Google-independent "Export Backup" really holds everything.

   It is the Centre's only backup that does not need Google Drive, and it is
   what would be restored if the Drive account were ever lost. It carried an
   explicit list and a handful of prefixes — and left out payroll (with its
   accounts and permission grants), the fee structure, fee documents, the fee
   and time-clock deletion lists, bank reconciliation and Income &
   Expenditure. Restored from it, the Centre would have lost its payroll
   history and every programme's price, and deleted payments would have come
   back on the first merge. (finance-23)

   Driven through the real exportDataBackup in index.html.

   Run: node tests/last-resort-export.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFunction(name) {
  const at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('index.html no longer defines ' + name);
  let depth = 0, i = SRC.indexOf('{', at);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(at, i + 1);
}

const stored = {
  cestisPayroll: '{"employees":[{"name":"J. Brown"}],"payrollRuns":[]}',
  dashboardUsers: '[{"username":"cestisadmin"}]',
  cestisPermissions: '[{"id":"P1"}]',
  cestiFeeStructure: '{"WELDING L2":{"total":28000}}',
  cestiSchoolFeeDocuments: '[{"id":"DOC1"}]',
  cestiSchoolFeeDeletedPaymentIds: '["R-2"]',
  cestiSchoolFeeDeletedLmsIds: '["S9"]',
  cestisTimeRecordTombstones: '["SESSION_10"]',
  'cestis_recon_bank_2026/2027_Q3_oct': '125000.50',
  'cestis_recon_uncleared_2026/2027_Q3_oct': '["T-1"]',
  'cestis_ie_settings': '{"x":1}',
  cestis_recon_logo: 'data:image/png;base64,AAAA',     // not JSON: must survive as stored
  cestisGoogleAccessToken: 'secret-token',               // never exported
  voctrain_sessionRole: 'admin'                          // nor this
};
let blobText = null;
const sb = {
  CESTISCore: Core, window: null,
  CESTISStore: { getItem: k => (k in stored ? stored[k] : null), keys: () => Object.keys(stored) },
  Blob: function (parts) { blobText = parts.join(''); },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  document: { createElement: () => ({ click() {} }) },
  // Export is for a signed-in administrator only (accounts-12); this test is about
  // WHAT an administrator's export holds, so it runs as one.
  currentRole: 'admin', currentLoggedInUser: { id: 'USR-001', role: 'admin' },
  showToast() {}, localDateStr: () => '2026-10-20',
  console: { warn() {}, log() {} }, JSON, Object, Date
};
sb.window = sb;
vm.createContext(sb);
vm.runInContext(extractFunction('safeJsonParse') + '\n' + extractFunction('exportDataBackup'), sb);
sb.exportDataBackup();
const backup = JSON.parse(blobText);

console.log('Every finance and HR collection is in the export');
['cestisPayroll', 'dashboardUsers', 'cestisPermissions', 'cestiFeeStructure', 'cestiSchoolFeeDocuments',
 'cestiSchoolFeeDeletedPaymentIds', 'cestiSchoolFeeDeletedLmsIds', 'cestisTimeRecordTombstones',
 'cestis_recon_bank_2026/2027_Q3_oct', 'cestis_recon_uncleared_2026/2027_Q3_oct', 'cestis_ie_settings'].forEach(k => {
  assert(k in backup.data, k + ' is exported');
});
assert(backup.raw && backup.raw.cestis_recon_logo === stored.cestis_recon_logo, 'a value that is not JSON is kept exactly as stored');
console.log('Nothing that must never leave the device');
assert(!('cestisGoogleAccessToken' in backup.data) && !(backup.raw && 'cestisGoogleAccessToken' in backup.raw), 'no Google token');
assert(!('voctrain_sessionRole' in backup.data), 'no session pointer');
assert(/Object\.keys\(backup\.raw \|\| \{\}\)\.forEach/.test(extractFunction('importDataBackup')), 'and the restore puts the raw values back');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
