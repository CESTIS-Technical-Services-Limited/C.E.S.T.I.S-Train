/* Export Backup carries every record collection the Centre keeps.

   What happened (found by tests/browser/upgrade-no-data-loss.js): a Centre's
   live-class attendance — who joined each video class and for how long,
   'voctrain_vcSessions' — was not in the "last-resort" Export Backup file.
   The export names most keys and then sweeps the rest of the store through the
   master-snapshot filter (CESTISCore.isSnapshotableKey), which skips every key
   with "session" in its name so that the sign-in session (voctrain_session*)
   never travels. 'voctrain_vcSessions' has "Sessions" in its name, so it was
   skipped too, and a Centre restoring from that file lost every VC register.

   Pinned here, with the REAL exportDataBackup() from index.html and the real
   cestis-core.js: every key the dashboard itself saves (read from index.html,
   so a collection added later is covered too) and every collection the sibling
   pages keep is in the exported file — and the sign-in session is not.

   Run: node tests/export-backup-completeness.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const Core = require('../cestis-core.js');

function extractFunction(src, name) {
  const re = new RegExp('(?:async\\s+)?function ' + name + '\\(');
  const m = re.exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

// Every voctrain_* key the dashboard writes by name.
const written = {};
const re = /(?:saveCollection\(|CESTISStore\.setItem\(|guardedSet\(CESTISStore,\s*)'(voctrain_[A-Za-z_]+)'/g;
let m;
while ((m = re.exec(SRC))) written[m[1]] = true;
// The sign-in session is per device and must never be in the file.
const SESSION = Object.keys(written).filter(k => /^voctrain_session/.test(k));
const DASHBOARD = Object.keys(written).filter(k => !/^voctrain_session/.test(k));
// What the sibling pages keep (School Fee, Cashbook, Payroll, Time Clock,
// Virements, Finance documents, Appraisals, the Board, Transcripts, Income &
// Expenditure), including the generated per-quarter keys.
const SIBLINGS = ['cestiSchoolFeeStudents', 'cestiSchoolFeePayments', 'cestiSchoolFeeDocuments', 'cestiFeeStructure',
  'cestiSchoolFeeDeletedPaymentIds', 'cestiSchoolFeeDeletedLmsIds', 'cestis_quarter_2026/2027_Q1', 'cestis_budget_2026/2027_Q1',
  'cestisPayroll', 'cestisStaffMembers', 'cestisTimeRecords', 'cesti_virements', 'cesti_virement_deleted_ids',
  'cestis_finance_invoices', 'cestis_finance_quotes', 'cestis_finance_pos', 'cestis_finance_voucher_overrides',
  'cestisStaffAppraisals', 'cestis_cmc_rulings', 'voctrain_transcriptGrades', 'voctrain_transcriptProfiles',
  'voctrain_certTranscriptRequests', 'voctrain_unitCatalogs', 'voctrain_attendance::2026/2027_Q1', 'cestis_ie_snapshot_2026/2027'];

console.log('Export Backup holds every collection the Centre keeps');
const store = {};
DASHBOARD.concat(SIBLINGS).concat(SESSION).forEach(k => { store[k] = JSON.stringify([{ id: 'R-' + k }]); });
let file = null;
const sb = {
  window: { CESTISCore: Core }, CESTISCore: Core,
  currentRole: 'admin', currentLoggedInUser: { id: 'USR-001' }, showToast: function () {},
  CESTISStore: { getItem: k => (k in store ? store[k] : null), keys: () => Object.keys(store) },
  safeJsonParse: function (v, d) { try { return JSON.parse(v); } catch (e) { return d; } },
  localDateStr: () => '2026-10-21',
  Blob: function (parts) { file = JSON.parse(parts.join('')); },
  URL: { createObjectURL: () => 'blob:', revokeObjectURL: () => {} },
  document: { createElement: () => ({ click: () => {} }) }
};
vm.createContext(sb);
vm.runInContext(extractFunction(SRC, 'exportDataBackup') + '\nexportDataBackup();', sb);
assert(!!file && file.data, 'the export produced a file');
const data = (file && file.data) || {};
assert(DASHBOARD.length > 30, 'the dashboard\'s own collections were found in index.html (' + DASHBOARD.length + ')');
DASHBOARD.forEach(k => assert(k in data, k + ' (written by the dashboard) is in the backup'));
SIBLINGS.forEach(k => assert(k in data, k + ' (a sibling page\'s collection) is in the backup'));
assert('voctrain_vcSessions' in data && data.voctrain_vcSessions[0].id === 'R-voctrain_vcSessions', 'the live-class registers are in it, as stored');
SESSION.forEach(k => assert(!(k in data), k + ' (this device\'s sign-in session) is NOT in the backup'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
