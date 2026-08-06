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
| `CESTIS_LMS_BACKUP.json` (accounts, exams, announcements, calendar, chat, approvals, settings, 30+ collections) | same | **implemented + tested** (`lms-backup`; every collection a lossless Tier-B document; roster/attendance/exam-results feed the shared identity pipeline) |
| `cestis-master-snapshot.json` + offline `CESTIS_ALL_DATA.json` | same | **implemented + tested** (`master-snapshot`: translates the store and runs every implemented extractor; every remaining key is ACCOUNTED — claimed, per-machine-excluded, deferred-to-finance-extractor, or loudly not-yet-mapped) |
| Cashbook / virement / finance-docs / voucher / payslip / clock page-cloud files (9 files) | same | **implemented + tested** (`finance-staff-pagecloud`: cashbook quarters as Tier-A entries with void supersession and a to-the-cent cashbook identity, budgets, virements with decisions, finance documents keeping their legacy numbers, payroll/clock/user stores as lossless documents) |
| Bespoke backup shapes (`CESTIS_CASHBOOK_DASHBOARD_BACKUP`, `Cashbook_Virement_Backup`, `employee_payroll_Backup`, per-user clock files) | same | deferred, named in the CLI's not-ingested list — their content duplicates the page-cloud/snapshot files; ingest only if found newer at migration time |
| Browser-local stores on each staff machine | **implemented + tested**: open `MegaData-Admin.html` on that machine → "Export local data" downloads `master-snapshot.<device>.<date>.json` (built by the legacy core's own `buildSnapshot`, checksum included; tokens/session state excluded by `isSnapshotableKey`; the broker secret lives outside CESTISStore so it *cannot* be included). Drop every machine's file into `--src` — the CLI recognises the name and routes it through the `master-snapshot` extractor | done |
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

**Stage-2 machinery (implemented and tested, dormant until sealed):** in shadow mode the fee
page's payment actions are wrapped so every legacy write becomes ledger events and syncs
immediately; the **broker issues the receipt number** and it is backfilled into the blank legacy
receipt field (a clerk-entered number is never overwritten — the broker also never renumbers a
payment that carries a preserved legacy number); payments pulled from other devices are
**mirrored into the legacy store** (original legacy ids; deterministic `MG-` ids for
mega-native ones, which the bridge refuses to re-import) with stored totals refreshed from the
fold; `window.__feeBalance()` answers from the fold. `tests/megadata-fee.test.js` covers the
number round-trip, the two-device mirror, mirror idempotence and the fold-vs-lying-stored-balance
case.

**Student-Progress stage 2 (implemented and tested, dormant until sealed):** roster scalars are
MUTABLE, so unlike append-only money the two-way flow runs a per-field **three-way merge**
against a baseline persisted in local meta — local-only changes push as audited events
(`person.corrected` / `doc.upserted` with state-hashed deterministic ids: a same-state race
dedupes to ONE event, a later toggle lands as its own), remote-only changes apply into the
legacy arrays the page renders, both-changed fields push local as last writer with BOTH
versions audited and the conflict reported. A local roster deletion tombstones the roster
**doc** and withdraws the enrolment — never the person, who may still owe fees (D11);
canonical-only trainees mirror in as legacy records; local tombstones are never resurrected.
One wrap point (`saveData`). `tests/megadata-sp.test.js` covers ping-pong prevention, conflict
last-writer, bio corrections, mirror-in, D11-safe deletion, and the same-edit race.

**Transcript-Grades (implemented and tested, dormant until sealed):** the SP three-way pattern
generalised into `docsync-model` for keyed Tier-B collections — grades, unit catalogues,
transcript profiles AND exam results (this page writes those too via its manual-override
write-back) each sync through one canonical doc per record, ids byte-pinned to bootstrap's
TIERB table. Removal is a soft `_removed` flag rather than a tombstone because the page
legitimately clears and re-adds a grade under the same deterministic id — presence gets the
same three-way treatment as values, so a device that already mirrored a removal cannot
re-remove another device's deliberate revival. One wrap point (`writeJSON`).
`tests/megadata-tg.test.js` covers all of it, including the profiles object-map boundary and
the array-field fold regression.

**Cashbook (implemented and tested, dormant until sealed; D11 — its own book):** Tier-A money
through `cashbook-model` — entries immutable, an in-place legacy edit becomes VOID + chained
replacement (linked by `supersedes`), a deletion a void with its reason, a cheque void
`cashbook.cheque.voided`, an UNVOID a replacement (the void event is permanent history). The
amount/class resolver moved to `megadata/cashbook-shared.js` so bootstrap and the live bridge
share one implementation by construction. **The per-device integer-id trap is defused**: legacy
txn ids are small per-device integers, so two devices can mint the same id for different money —
bridge-born entries get CONTENT-hashed entity ids, legacy txns are stamped with `megaId` as the
stable join, and mirrored-in txns are remapped on collision. `window.__cbReconcile()` compares
every stored quarter against the fold to the cent (voided count zero, exactly like legacy
`calcTotals`), opening balances included. Budgets stay legacy for now: `budget.set` is
create-once in the registry, so live re-sets need a deliberate registry change (autovivify the
`budget` kind) taken as its own reviewed step. One wrap point set: `saveToStorage`,
`saveTxnToQuarter`, `saveQuarterAndSwitch`. `tests/megadata-cb.test.js` covers the drift guard,
edit/void/unvoid/deletion chains, the id trap end-to-end, the mirror (remap + supersedes-chain
edits + legacy-semantics voids), cancelled-zero documents, and the comparator catching a lying
opening balance.

**Staff.Payslip + Staff.Clock.in (implemented and tested, dormant until sealed):** seven
docsync kinds pinned to the finance-staff extractor's tierbDoc keys — payroll settings
(singleton), employees (by NAME — a rename is new doc + soft removal, bootstrap semantics),
payroll runs (by date), dashboard users, permission requests, staff members and time records.
The payroll store is one key with nested collections, so it decomposes/recomposes at the model
boundary with every guard field (high-water marks) preserved verbatim and key-less records
reported but kept local. The payslip page has no in-memory reloader, so its mirror keeps
STORAGE canonical and the screen catches up on next load — the wrap-after-save re-mirror means
a stale in-memory save can never permanently clobber a mirrored record. Cashbook-written
salary runs bridge on the payslip page's next tick (deterministic ids make origin irrelevant).
Time-correction semantic elevation (`time.corrected`) stays a named deferred step.
`tests/megadata-ps.test.js` covers all seven drift guards, the decompose/recompose contract,
rename, the cashbook hand-off, cross-device clock corrections, and the same-edit race.

**Finance documents (implemented and tested, dormant until sealed):** invoice / quote /
purchase-order pages (one shared `FinanceDoc` engine → one glue) bridge as Tier-A findocs —
`findoc.issued` with the page-minted number PRESERVED (broker numbering takes over only at the
enforced stage), edits as `findoc.superseded` diffs (canonical comparison, so line-item ARRAYS
diff and fold correctly — the same [old,new] fold bug fixed for doc.upserted was found and
fixed in the findoc fold too), deletions as `findoc.voided` via presence three-way; canonical
voids remove stale local copies, never resurrect. Mirror-in reconstructs the FULL legacy record
from the event's `doc` payload. **Duplicate numbers** (each device seeds its own series, and
deleting the newest doc frees its number) are REPORTED by `window.__findocReconcile()` for
human review — never auto-renumbered. The Payment-Voucher page syncs only its overrides map
(docsync objmap, keys pinned to the bootstrap extractor; map key rides as `__k` — bootstrap-born
overrides sync one-way until first touched locally, noted not hidden). Payments.Invoices is a
read-only view and needs no bridge. `tests/megadata-fd.test.js` covers all of it.

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
- The in-app "export local stores" step is DONE: `MegaData-Admin.html` card 3 (see the §2
  source table row); its bundle round-trips losslessly through the real extractor in
  `tests/megadata-admin.test.js` and in the real-browser suite.
