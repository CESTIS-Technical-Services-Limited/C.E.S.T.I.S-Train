# Phase 4 — Bootstrap, Merge and Cutover

The one-time migration of everything the platform holds into MegaData, and the conditions under
which the legacy save paths may be retired. Binding inputs: the signed Section 0 amendments
(operator-run CLI, idempotent convergence, adjudication queue, scoped dual-write shadow), the
signed principles P1–P12, decisions D1–D11. The pipeline described here is implemented in
`megadata/bootstrap-core.js` + `megadata/bootstrap-cli.js` and exercised by
`tests/megadata-bootstrap.test.js` against the Centre's real (anonymised) fee backup.

---

## 1. Trigger: an operator-run CLI. The human is the lock.

Bootstrap is **never** triggered by a login or a page load. One named operator runs
`node megadata/bootstrap-cli.js` on one machine, twice: once without `--commit` (the dry run —
the client's review artifact) and once with it, after sign-off. Rationale (signed verdict Q3):
no correct cross-user lock exists on raw Drive; a browser tab is the wrong runtime for an
hours-long job; and organisational single-flight (one operator, one machine, one run) is the
only mutual exclusion this stack can honestly provide. Two mechanical gates back the human up:

- **The broker gate** (`gate` endpoint, behind Apps Script `LockService` — the one real mutex in
  scope): `bootstrap = not-started | running | sealed`. The web app refuses normal MegaData
  operation until `sealed`; the CLI sets `running` before committing and `sealed` only after
  verification passes. If the broker is not yet deployed at migration time, the same gate lives
  in the committed `head.json` the CLI produces — clients treat "no sealed marker" as
  maintenance mode.
- **An advisory staging lock**: the CLI's staging directory contains the checkpoint; a second
  concurrent run against the same staging dir resumes rather than forks, and a run against a
  different dir produces the byte-identical event set anyway (determinism, §3) — so even the
  failure of every gate cannot double-import.

## 2. Sources

| Source | How it reaches the CLI | Extractor status |
|---|---|---|
| `CESTIS_School_Fees.json` + `school_fee_management_system.json` (both fee Drive files) | operator downloads from Drive into `--src` | **implemented + tested** (`schoolfee-pagecloud`; the legacy System-1 file shares the same inner shape) |
| `CESTIS_Student_Progress.json` (LMS roster + tombstones + attendance + exam results) | same | **implemented + tested** (`student-progress-pagecloud`; cross-source identity unification with the fee roll via corroborated id-links — a link joining conflicting names is a human-queue item, never a merge) |
| `CESTIS_Transcript_Requests.json` | same | **implemented + tested** (`transcript-requests-pagecloud`) |
| `CESTIS_Transcript_Grades.json` (manual grades, unit catalogues, transcript profiles) | same | **implemented + tested** (`transcript-grades-pagecloud`; lossless Tier-B documents, semantic elevation deferred to a reviewed step) |
| `CESTIS_LMS_BACKUP.json`, `cestis-master-snapshot.json` | same | next (with the index.html refactor) |
| Cashbook/virement/voucher/payslip/clock/transcript page-cloud files (10 more) | same | next (with each page's refactor) |
| Browser-local stores on each staff machine | **in-app "Export local stores" button** (one click per staff browser, uploads a hashed bundle to a staging folder) — built with the page-refactor step; a CLI cannot read IndexedDB | next |
| `Offline System/data/` folders, if any Centre ran offline | operator copies the folder into `--src` | same extractors (identical file shapes) |

Every file in `--src` is either matched to an extractor or **listed as not-ingested** in the
plan output — an unmatched source is a loud line item, never a silent skip. The real run may not
proceed while any expected source appears in that list.

## 3. Determinism — why re-runs and crashes cannot double-import

- The **run stamp** is fixed at first invocation and carried in the checkpoint; every
  synthesized event's `at` is that stamp. No wall-clock, no randomness anywhere in the pipeline.
- **Event ids** are `evt_m<sha256(srcFileId | recordPath#type | transformV)>`; **entity ids**
  are `per_m/enr_m/prg_m/int_m/fsc_m<sha256(identity key)>`. Two runs over the same sources
  produce the byte-identical event set — proven in tests (`canon(runA) === canon(runB)`), and
  proven again across an interrupt/resume.
- The broker's dedupe-by-event-id answers any replayed append with the original acks, so even
  "committed twice" collapses to once.

## 4. Pipeline (implements spec 6.2's ten steps)

| Spec step | Where | Checkpoint |
|---|---|---|
| 1 Pre-flight | CLI: sources readable + matched; broker reachable (or explicitly deferred); staging writable | (start) |
| 2 Inventory | `stepExtract`: per-source sha-256, byte size, record counts; **financial baseline = Σ atomic live payments in integer cents** (never stored balances); float-precision notes | `extract` |
| 3 Extract | same step: every record staged or quarantined with a named reason (no-id records, unparseable JSON) | `extract` |
| 4 Identity resolution | `stepResolve`, tiers per the signed policy — **A (auto)**: exact record id across sources, or exact non-empty national id. **B (human queue)**: same name + same DOB without a strong id — imported as separate people, queued with the suggestion. **C (kept separate)**: same name alone — listed, never merged. Fuzzy similarity never merges anything (P6) | `resolve` |
| 5 Conflict resolution | inside resolve/synthesize: per-field, **atomic-beats-derived** always; within a tier-A group, newest `updatedAt` wins for bio fields with every losing value recorded in the decisions journal; **financial fields are never auto-resolved** — stored balances are not data (see step 8) | `resolve` |
| 6 Event synthesis | `stepSynthesize`: programmes/intakes/schedules from the fee structure; person + enrolment per resolved identity × programme; charges from the trainee's priced tuition (unpriced stays unpriced); payments from atomic records (legacy-tombstoned ones accounted, not imported); every event carries `prov: {importRun, srcFile, srcPath}` | `synthesize` |
| 7 Structure | `--commit` writes `out/events` + report; the broker deploy kit turns them into log segments + `head.json` + snapshot in the MegaData folder tree (step-7 work) | `synthesize` |
| 8 Project | `stepVerify` folds all projections from the synthesized log | `verify` |
| 9 Verify | §5 below | `verify` |
| 10 Seal | broker gate → `sealed`; immutable import report written to `MegaData/import/<runId>/` | (end) |

**Checkpoint design:** one record `{step, runStamp, transformV}` in the staging store, written
after each step. Resume re-derives the completed prefix from the same deterministic functions
(cheap at this scale — the full real fixture runs in seconds) and continues live from the next
step; the test suite interrupts after `resolve` and proves the resumed run's event set is
byte-identical to an uninterrupted one. A checkpoint whose `runStamp`/`transformV` mismatch the
invocation is refused, not merged.

**Backup-first (spec 6.1):** before the commit run, the operator's download of every legacy
Drive folder **is** the backup — it is copied, dated, checksummed by the inventory step, and
never modified (the CLI opens sources read-only). The inventory's per-file sha-256 list is the
"backup verified" evidence. Browser-local stores are backed up by their export bundles.

## 5. Verification (runs inside every invocation, dry or committed)

1. **Broker-gate replay**: every synthesized event is appended through the real
   `broker-core` validation (schema, refs, liveness, reversal/tombstone gates). One rejection
   fails the run loudly.
2. **Hash chain** over the synthesized log verifies end-to-end.
3. **Financial identity, to the cent**: `Σ imported payment events + Σ explicitly-quarantined
   payments == inventory baseline`. This is the "zero unexplained gaps" gate — quarantine is
   *accounted*, not excused.
4. **Stored-balance fixtures**: every legacy stored balance is compared against the fold;
   disagreements are counted and listed for human review (they are the seed of the financial
   adjudication queue), never auto-absorbed. The committed real fixture currently reconciles at
   **0 disagreements over 368 trainees**.
5. **Counts reconcile**: every staged record is imported, queued, kept-separate, tombstoned or
   quarantined — the report enumerates each bucket.

## 6. The dry run is the review gate

`bootstrap-cli --src <dir>` (no `--commit`) produces the complete plan — inventory with hashes,
tier distribution, the full adjudication queue, every quarantined record with its reason, the
decisions journal, the event counts by type, and the verification results — and writes **no
output**. The client reviews and signs this plan; only then is `--commit` run. (Spec Phase 5
item 5, elevated as promised in the Section 0 verdict.)

## 7. Rollback

Bootstrap writes only: the staging directory, `out/` events + report, and (deploy step) new
files under `MegaData/` plus the gate marker. Legacy folders and stores are opened read-only
throughout. Therefore rollback at ANY point before cutover is: delete/ignore the MegaData
output, clear the gate marker, and the platform continues on its legacy paths untouched. There
is no partial-mutation state to repair — the strongest rollback property available, and the
reason the pipeline writes nothing into legacy systems ever.

## 8. Shadow period (D2: fees are per-term)

After the committed bootstrap and the fee/roster page refactors, the DAL dual-writes **students
and the fee ledger only** into the legacy keys while MegaData is primary. The nightly comparator
recomputes both sides *from atomic records* and reports per-trainee balances to the cent plus
bidirectional entity-id set differences; each report is an immutable dated file.

- **Window**: one full **term boundary** — from before a term's charges are assessed, through
  its payment-heavy opening weeks — plus ordinary weeks, minimum 4 calendar weeks total.
  Concretely: start the shadow ≥1 week before the next term's fee window opens; do not exit
  before the term's first payment rush has been through both books.
- **Exit criteria**: ≥10 consecutive zero-divergence business days **including** the
  charge-assessment day and at least one heavy payment day; any divergence resets the streak
  after a root-caused fix; three resets → design review, not a fourth silent retry.
- Legacy read paths stay behind a feature flag until final sign-off (rollback = flag flip).

## 9. Cutover checklist (spec 6.3 — every line needs written evidence before legacy paths retire)

| # | Condition | Evidence slot |
|---|---|---|
| 1 | Every inventoried record accounted (imported / queued-and-decided / kept-separate / tombstoned / quarantined-with-reason) | import report §counts, quarantine list |
| 2 | Financial identity holds to the cent, per trainee and aggregate, against the **adjudicated baseline** (imported + quarantined = inventory; every stored-balance disagreement carries a recorded human decision) | verification block + adjudication decisions journal |
| 3 | Adjudication queue: **zero open financial items**; every identity item has a recorded disposition (merged / kept-separate / deferred-duplicate) | queue export with decisions |
| 4 | Every page reads exclusively through the DAL; enforcement shim reports **zero violations in throw mode** across the full Playwright suite | shim report artifact |
| 5 | Full Phase 6 verification suite passes | `docs/03-VERIFICATION.md` outputs |
| 6 | Shadow period exit criteria met (§8) | dated comparator reports |
| 7 | Client signs the import report | signature slot in `MegaData/import/<runId>/report` |

Retiring = **disconnecting, never deleting**: legacy Drive folders become a frozen archive,
legacy code paths are removed from the pages, and the legacy stores on staff machines are left
in place (they age out naturally). Nothing is deleted by the system, ever.

## 10. Honest gaps at this writing

- Extractors beyond the fee system land with each page's refactor (§2 table) — the pipeline,
  tiers, verification and reporting are source-agnostic and already proven on the largest and
  most sensitive source.
- Live Drive fetch/upload and the Apps Script deploy kit are the step-7 work and are untestable
  from this environment (spec 5.3); everything above them runs against the filesystem adapters
  behind the same interfaces.
- The in-app "export local stores" step ships with the first page refactor.
