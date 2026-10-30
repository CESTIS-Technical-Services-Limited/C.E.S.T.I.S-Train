#!/usr/bin/env node
/* ============================================================================
   tools/run-tests.js — run every Node test suite and say what failed.

   `npm test` used to be one long `node a && node b && …` line: the first
   failing suite stopped the run, so a second broken thing stayed hidden until
   the first was fixed, and the counts quoted in the README were typed by hand.
   This runs every suite in SUITES (in this order), keeps going past a
   failure, and ends with a summary: how many suites passed, how many checks
   they made, and the name of every suite that failed. It exits 1 if any did.

   A test file in tests/ that is not in SUITES still runs (after the list), and
   the summary names it, so a new test can never be forgotten. Add it to the
   list where it belongs.

   USE
     node tools/run-tests.js             every suite (what `npm test` runs)
     node tools/run-tests.js -v          and print every suite's own output
     node tools/run-tests.js gate- fee   only the suites whose path contains
                                         one of these words
   Zero dependencies — plain Node.
   ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/* Every Node suite, in the order `npm test` has always run them. */
const SUITES = [
  'tests/cestis-core.test.js', 'tests/course-catalogue.test.js', 'tests/twin-index.test.js', 'tests/centre-counts.test.js',
  'tests/centre-key-identity.test.js', 'tests/centre-drift.test.js', 'tests/identity-churn.test.js', 'tests/intake-level-match.test.js',
  'tests/same-name-collapse.test.js', 'tests/transcript-core.test.js', 'tests/transcript-records.test.js', 'tests/transadmin-pages.test.js',
  'tests/finance-core.test.js', 'tests/staff-appraisals.test.js', 'tests/cmc-portal.test.js', 'tests/income-expenditure.test.js',
  'tests/enrolment-core.test.js', 'tests/school-fee-programmes.test.js', 'tests/fee-intake-collapse.test.js', 'tests/school-fee-perf.test.js',
  'tests/school-fee-seed.test.js', 'tests/school-fee-dashboard-scope.test.js', 'tests/reports-analytics.test.js', 'tests/system-settings-merge.test.js',
  'tests/cert-vc-core.test.js', 'tests/cert-template-seed.test.js', 'tests/certificate-portal.test.js', 'tests/vc-sessions.test.js',
  'tests/account-access.test.js', 'tests/account-store-key.test.js', 'tests/two-step-login-layer.test.js', 'tests/two-step-state-sync.test.js',
  'tests/storage-durability.test.js', 'tests/security-and-approvals.test.js', 'tests/money-correctness.test.js', 'tests/sync-preconditions.test.js',
  'tests/build-parity.test.js', 'tests/roster-settles-on-sync.test.js', 'tests/school-fee-ui.test.js', 'tests/school-fee-year-records.test.js',
  'tests/school-fee-carry-forward.test.js', 'tests/account-deletion.test.js', 'tests/account-merge.test.js', 'tests/sync-integrity.test.js',
  'tests/record-sync.test.js', 'tests/admin-staff-access.test.js', 'tests/course-end-status.test.js', 'tests/course-end-transcript.test.js',
  'tests/attendance-register.test.js', 'tests/transfer-core.test.js', 'tests/cloud-merge.test.js', 'tests/deletion-tombstones.test.js',
  'tests/page-cloud.test.js', 'tests/shared-cloud-read.test.js', 'tests/no-data-loss.test.js', 'tests/megadata-schemas.test.js',
  'tests/megadata-broker.test.js', 'tests/megadata-dal.test.js', 'tests/megadata-bootstrap.test.js', 'tests/megadata-glue.test.js',
  'tests/megadata-ctr.test.js', 'tests/megadata-sp.test.js', 'tests/megadata-fee.test.js', 'tests/megadata-admin.test.js',
  'tests/megadata-tg.test.js', 'tests/megadata-cb.test.js', 'tests/megadata-echo.test.js', 'tests/megadata-ps.test.js',
  'tests/megadata-fd.test.js', 'tests/megadata-adjq.test.js', 'tests/megadata-lms.test.js', 'tests/megadata-upload.test.js',
  'tests/megadata-drive-fetch.test.js', 'tests/megadata-appsscript-vm.test.js', 'tests/xss-escaping.test.js', 'tests/school-fee-sync-merge.test.js',
  'tests/clockin-slice-merge.test.js', 'tests/payslip-sync-merge.test.js', 'tests/cashbook-merge.test.js', 'tests/virement-edit-approval.test.js',
  'tests/finance-docs-sync.test.js', 'tests/shared-read-owner-stamp.test.js', 'tests/last-resort-export.test.js', 'tests/offline-build.test.js',
  'tests/lan-record-merge.test.js', 'tests/lan-page-cloud.test.js',
  'Offline System/tests/offline-server-hardening.test.js', 'Offline System/tests/offline-signalling.test.js', 'Offline System/tests/offline-store.test.js',
  'tests/published-default-login.test.js', 'tests/registration-review-queue.test.js', 'tests/record-page-session-gate.test.js', 'tests/account-identity-linking.test.js',
  'tests/account-state-sync.test.js', 'tests/backup-export-import.test.js', 'tests/otp-no-demo-fallback.test.js', 'tests/online-exams.test.js',
  'tests/cert-issuance.test.js', 'tests/cert-portal-fixes.test.js', 'tests/cert-signing.test.js', 'tests/vc-room.test.js',
  'tests/vc-page.test.js', 'tests/coursework-marks.test.js', 'tests/comms-bell-announcements.test.js', 'tests/chat-safety.test.js',
  'tests/sync-durability.test.js', 'tests/ui-accessibility.test.js', 'tests/service-worker.test.js', 'tests/review-data-loss.test.js',
  'tests/megadata-bat-lint.test.js', 'tests/review-security.test.js', 'tests/exam-grading-panel.test.js', 'tests/lan-push-adopt.test.js',
  'tests/lan-login-sync.test.js', 'tests/session-record-follows-roll.test.js', 'tests/lan-host-ticket-first-run.test.js', 'tests/centre-fuzzy-rewrite.test.js',
  'tests/lan-cert-images.test.js', 'tests/exam-review-ux.test.js', 'tests/export-backup-completeness.test.js', 'tests/lan-legacy-attendance-carryover.test.js',
  'tests/fee-placeholder-merge.test.js', 'tests/tombstone-id-types.test.js', 'tests/backup-import-shell.test.js', 'tests/virement-locked-page-save.test.js',
  'tests/cashbook-signin-screen-sync.test.js', 'tests/pre-upgrade-carry.test.js', 'tests/cert-page2-columns.test.js', 'tests/cert-course-type-editor.test.js',
  'tests/ui-no-sync-source-wording.test.js', 'tests/exam-question-types.test.js', 'tests/theme-tokens.test.js', 'tests/email-signin-approval.test.js',
  'tests/backfill-stub-fold.test.js', 'tests/force-change-pw-focus.test.js', 'tests/ui-phone-search.test.js', 'tests/ui-phone-tables.test.js',
  'tests/ui-min-text-size.test.js', 'tests/ui-image-alt.test.js', 'tests/sign-in-feedback.test.js', 'tests/sync-health-chip.test.js',
  'tests/form-modal.test.js', 'tests/theme-one-look.test.js', 'tests/exam-attempt-travel.test.js', 'tests/sign-in-merge-version.test.js',
  'tests/gate-slice.test.js', 'tests/gate-validate.test.js', 'tests/gate-auth.test.js', 'tests/gate-exam.test.js',
  'tests/gate-collector.test.js', 'tests/gate-cleanup.test.js', 'tests/gate-appsscript-vm.test.js', 'tests/store-namespace.test.js',
  'tests/gate-lan.test.js', 'tests/gate-contract.test.js', 'tests/gate-publisher.test.js', 'tests/gate-card-ready.test.js',
  'tests/student-id-moves.test.js', 'tests/exam-invigilation.test.js', 'tests/gate-client.test.js', 'tests/office-trainee-accounts.test.js',
  'tests/home-registration.test.js', 'tests/vc-small-room-joiners.test.js', 'tests/idle-lock-live-class.test.js', 'tests/idle-lock-gate-unlock.test.js',
  'tests/gate-live-badge.test.js', 'tests/trainee-home-wording.test.js', 'tests/gradebook-all-items.test.js', 'tests/exam-new-question-no-key.test.js',
  'tests/resource-needs-link.test.js', 'tests/notice-audience.test.js', 'tests/pass-rate-from-marks.test.js', 'tests/centre-figures.test.js',
  'tests/course-end-keeps-dropouts.test.js', 'tests/student-progress-export-filtered.test.js', 'tests/trainee-contact-from-account.test.js', 'tests/fee-receipt-duplicate.test.js',
  'tests/home-study.test.js', 'tests/chat-history-not-emptied.test.js', 'tests/sync-idle-quiet.test.js', 'tests/backup-copy-cadence.test.js',
  'tests/lan-partial-save.test.js', 'tests/page-cloud-rewrite.test.js', 'tests/attendance-index-trust.test.js', 'tests/cashbook-idle-sync.test.js',
  'tests/board-figures.test.js', 'tests/exam-marking-speed.test.js', 'tests/message-trainee.test.js', 'tests/needs-attention.test.js',
  'tests/coursework-feedback.test.js', 'tests/exam-reuse.test.js', 'tests/class-list.test.js', 'tests/office-watch.test.js',
  'tests/instructor-uploads.test.js', 'tests/unit-proposals.test.js', 'tests/office-today.test.js', 'tests/admin-staff-working-pages.test.js',
  'tests/fee-receipt-numbers.test.js', 'tests/fee-idle-cover.test.js', 'tests/fee-unpriced-details.test.js', 'tests/office-announcement-programme.test.js',
  'tests/requests-run-themselves.test.js', 'tests/student-progress-bulk.test.js', 'tests/new-trainee-form.test.js', 'tests/sign-in-slips.test.js',
  'tests/academic-year-options.test.js', 'tests/version-tags.test.js', 'tests/centre-config.test.js',
  'tests/megadata-dormant.test.js'
];

/* tests/*.test.js files that are not in SUITES. They run too (see above). */
function unlisted() {
  const listed = new Set(SUITES);
  return fs.readdirSync(path.join(ROOT, 'tests')).filter(f => /\.test\.js$/.test(f)).sort()
    .map(f => 'tests/' + f).filter(f => !listed.has(f));
}

/* "123 passed, 0 failed" (and the like) from the end of a suite's output. */
function checksIn(out) {
  const lines = String(out || '').split('\n').reverse();
  for (const l of lines) {
    const m = /(\d[\d,]*)\s+(?:[a-z-]+\s+){0,2}(?:checks?|tests?)?\s*passed/i.exec(l);
    if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  }
  return null;
}

const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function run(argv) {
  const verbose = argv.includes('-v') || argv.includes('--verbose');
  const words = argv.filter(a => a.charAt(0) !== '-');
  const extra = unlisted();
  let todo = SUITES.concat(extra);
  if (words.length) todo = todo.filter(f => words.some(w => f.indexOf(w) !== -1));
  const missing = todo.filter(f => !fs.existsSync(path.join(ROOT, f)));
  const results = [];
  const t0 = Date.now();
  todo.forEach(f => {
    if (missing.includes(f)) { results.push({ file: f, ok: false, why: 'file not found' }); console.log('✗ ' + f + ' — file not found'); return; }
    const s = Date.now();
    const r = spawnSync(process.execPath, [f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 15 * 60 * 1000 });
    const out = (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '');
    const ok = r.status === 0 && !r.error && !r.signal;
    const checks = checksIn(r.stdout);
    const secs = ((Date.now() - s) / 1000).toFixed(1);
    results.push({ file: f, ok, checks, secs, why: r.error ? r.error.message : (r.signal ? 'stopped (' + r.signal + ')' : (ok ? '' : 'exit code ' + r.status)) });
    if (verbose || !ok) process.stdout.write(out.replace(/\s+$/, '') + '\n');
    console.log((ok ? '✓ ' : '✗ ') + f + (checks != null ? ' (' + fmt(checks) + ' checks)' : '') + ' ' + secs + ' s' + (ok ? '' : ' — FAILED: ' + results[results.length - 1].why));
  });
  const failed = results.filter(r => !r.ok);
  const checks = results.reduce((n, r) => n + (r.ok && r.checks ? r.checks : 0), 0);
  console.log('\n──────── Summary ────────');
  console.log(fmt(results.length) + ' suites: ' + fmt(results.length - failed.length) + ' passed, ' + fmt(failed.length) + ' failed; ' +
    fmt(checks) + ' checks passed; ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s.');
  if (extra.length && !words.length) {
    console.log('Not in the list in tools/run-tests.js (they ran anyway; add them): ' + extra.join(', '));
  }
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach(r => console.log('  ' + r.file + ' — ' + r.why));
  }
  return failed.length ? 1 : 0;
}

module.exports = { SUITES, unlisted, checksIn };

if (require.main === module) process.exit(run(process.argv.slice(2)));
