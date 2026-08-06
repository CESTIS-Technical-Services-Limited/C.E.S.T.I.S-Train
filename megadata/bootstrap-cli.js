#!/usr/bin/env node
/* MegaData — operator-run bootstrap CLI (docs/04). The human is the lock:
   one named operator, one machine, one run. Never triggered from a login.

   Usage:
     node megadata/bootstrap-cli.js --src <dir> [--out <dir>] [--commit] [--run-id imp_YYYY-MM-DD-n]

   --src    directory of legacy source files (downloaded Drive JSON payloads
            and in-app local-store export bundles). Each file is matched to an
            extractor by name; unmatched files are listed, never silently
            ignored. Live-Drive fetching is deliberately NOT built in yet —
            the operator downloads the folders (or uses the export step), so
            this environment's lack of Drive access changes nothing (spec 5.3).
   --out    staging/checkpoint directory (default: ./megadata-bootstrap-staging)
   --commit actually write the output events + report to --out/out.json;
            WITHOUT it this is a DRY RUN: full report, zero output writes.
   The run stamp is fixed on first run and carried in the checkpoint; a rerun
   with the same staging dir resumes (idempotently) rather than starting over. */
'use strict';
const fs = require('fs');
const path = require('path');
const { FileAdapter } = require('./adapters.js');
const BOOT = require('./bootstrap-core.js');

const args = process.argv.slice(2);
function arg(name, dflt) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }
const srcDir = arg('--src', null);
const outDir = arg('--out', './megadata-bootstrap-staging');
const commit = args.includes('--commit');
const runId = arg('--run-id', 'imp_' + new Date().toISOString().slice(0, 10) + '-1');

if (!srcDir) { console.error('usage: bootstrap-cli --src <dir> [--out <dir>] [--commit]'); process.exit(2); }

// File-name → extractor kind. Every legacy source gets an entry here as its
// extractor is implemented; anything unmatched is REPORTED (spec 6.2 step 2).
const KIND_BY_NAME = [
  { re: /school[-_ ]?fees?.*\.json$/i, kind: 'schoolfee-pagecloud' },
  { re: /CESTIS_School_Fees\.json$/i, kind: 'schoolfee-pagecloud' },
  { re: /school_fee_management_system\.json$/i, kind: 'schoolfee-pagecloud' },
  { re: /Transcript_Requests\.json$/i, kind: 'transcript-requests-pagecloud' },
  { re: /Student_Progress\.json$/i, kind: 'student-progress-pagecloud' },
  { re: /Transcript_Grades\.json$/i, kind: 'transcript-grades-pagecloud' },
  { re: /CESTIS_LMS_BACKUP\.json$/i, kind: 'lms-backup' },
  { re: /CESTIS_LMS_Dashboard\.json$/i, kind: 'lms-backup' },
  { re: /master-snapshot\.json$/i, kind: 'master-snapshot' },
  { re: /CESTIS_ALL_DATA\.json$/i, kind: 'master-snapshot' },
  { re: /CESTIS_(Cashbook|Virement_Requests|Finance_Invoices|Finance_Quotes|Finance_PurchaseOrders|Payments_Invoices|Payment_Vouchers|Staff_Payslips|Staff_TimeClock)\.json$/i, kind: 'finance-staff-pagecloud' }
];

const sources = [], unmatched = [];
for (const f of fs.readdirSync(srcDir).sort()) {
  if (!f.toLowerCase().endsWith('.json')) { unmatched.push(f + ' (not JSON)'); continue; }
  const m = KIND_BY_NAME.find(k => k.re.test(f));
  if (!m) { unmatched.push(f + ' (no extractor yet)'); continue; }
  try {
    sources.push({ id: 'file:' + f, kind: m.kind, name: f, json: JSON.parse(fs.readFileSync(path.join(srcDir, f), 'utf8')) });
  } catch (e) { unmatched.push(f + ' (unreadable: ' + e.message + ')'); }
}

const adapter = FileAdapter(outDir);
adapter.get('checkpoint', 'state').then(cp => {
  const runStamp = (cp && cp.runStamp) || new Date().toISOString();
  if (cp) console.log('Resuming run ' + runId + ' from checkpoint "' + cp.step + '" (stamp ' + cp.runStamp + ')');
  else console.log((commit ? 'COMMIT' : 'DRY') + ' run ' + runId + ' over ' + sources.length + ' source(s); stamp ' + runStamp);
  if (unmatched.length) console.log('NOT ingested (no extractor / unreadable):\n  - ' + unmatched.join('\n  - '));
  return BOOT.runBootstrap({ sources, adapter, dryRun: !commit, runStamp, runId });
}).then(rep => {
  console.log('\n===== IMPORT ' + (rep.dryRun ? 'PLAN (dry run — nothing written)' : 'REPORT') + ' =====');
  console.log('Sources:            ' + rep.inventory.sources.map(s => s.name + ' sha256:' + s.sha256.slice(0, 12) + ' (' + JSON.stringify(s.counts) + ')').join('\n                    '));
  console.log('Trainee records:    ' + rep.inventory.totals.students);
  console.log('Live payments:      ' + rep.inventory.totals.payments + '  (tombstoned in legacy: ' + rep.inventory.totals.tombstonedPayments + ')');
  console.log('Payments baseline:  ' + (rep.inventory.totals.paymentsTotalMinor / 100).toFixed(2) + ' (from atomic records)');
  console.log('Identity tiers:     A(auto)=' + rep.tierCounts.A + '  B(human queue)=' + rep.tierCounts.B + '  C(kept separate)=' + rep.tierCounts.C);
  console.log('Quarantined:        ' + rep.quarantine.length + (rep.quarantine.length ? '  (every item listed in the staging dir — nothing dropped)' : ''));
  console.log('Events synthesized: ' + rep.events.count + '  ' + JSON.stringify(rep.events.byType));
  console.log('Broker validation:  ' + rep.verification.brokerAccepted + ' accepted; chain verified: ' + rep.verification.chainVerified);
  console.log('Financial identity: imported ' + (rep.verification.paymentsTotalMinor / 100).toFixed(2)
    + ' + quarantined ' + (rep.verification.quarantinedPaymentsMinor / 100).toFixed(2)
    + ' == inventory ' + (rep.verification.inventoryTotalMinor / 100).toFixed(2)
    + '  →  ' + (rep.verification.financialIdentityHolds ? 'HOLDS' : '*** FAILS ***'));
  console.log('Stored-balance disagreements (human review): ' + rep.verification.storedBalanceDisagreements);
  if (!rep.verification.financialIdentityHolds) process.exitCode = 1;
  if (rep.dryRun) console.log('\nReview the plan (incl. ' + rep.adjudicationQueue.length + ' adjudication item(s) in the staging dir), then rerun with --commit.');
  else console.log('\nCommitted to ' + outDir + '/out.json. Next: upload segments via the broker deploy kit.');
}).catch(e => { console.error('BOOTSTRAP FAILED: ' + e.message); process.exit(1); });
