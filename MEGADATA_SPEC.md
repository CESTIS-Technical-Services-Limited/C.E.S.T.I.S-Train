# Claude Code Task Brief — LMS Unification & MegaData Layer

> Paste this whole file as your opening prompt, or save it to the repo root and start the session with:
> `Read MEGADATA_SPEC.md and execute it phase by phase. Stop at each phase gate for my sign-off.`

---

## 0. Answer Before You Act

**Before Phase 0, before reading anything, before writing a line of code — respond to me in writing.**

This brief describes an approach I have specified. I want your honest engineering assessment of whether it will actually work, effectively and efficiently, at the scale and in the environment this platform runs in. Do not agree with me to be agreeable. If part of this plan is wrong, weak, or naive, say so plainly and propose the better version.

Address specifically:

1. **Is a single append-only event log plus computed projections the right shape for this platform**, given its size and how it is deployed? Where does this design cost more than it returns?
2. **Is Google Drive an adequate primary datastore** for a system of record holding student and fee data? Be direct about latency, API rate limits, quota, concurrent-write behaviour, lack of transactions, and what happens when two people write at once. If Drive should be a durable *mirror* rather than the primary store, say so and tell me what the primary should be.
3. **Is "run the merge on first refresh/launch" a safe trigger?** Consider: multiple users logging in simultaneously, a tab refreshed mid-merge, a merge that partially completes, a merge that takes longer than a user will wait at a login screen. Tell me whether this should be an admin-initiated, single-flight, resumable job instead.
4. **Can legacy data be merged automatically at all?** Where two legacy sources disagree about the same student or the same fee balance, what decides? Tell me honestly whether some conflicts require a human to adjudicate, and design the queue for that if so.
5. **Is "abandon the old paths once the source of truth exists" safe as a hard cutover?** Or does it need a shadow period where the new system runs alongside the old and the two are compared before the old is retired?
6. **What in this brief is not achievable**, and what would you do instead?

Give me a clear verdict — **proceed as specified / proceed with these amendments / this approach will fail for these reasons** — and wait for my response. Everything below is subject to that conversation.

---

## 1. Role and Mission

You are acting as the lead engineer on an existing Learning Management System (LMS) platform. The platform is currently a set of pages / HTML sub-systems that each hold and interpret data independently. The result is that different pages report different "truths" for the same records — especially students and fees.

Your mission has three parts:

1. **Diagnose** every place where data diverges between pages/sub-systems.
2. **Re-architect** the platform around a single canonical data layer called **MegaData**, so that no page ever invents, derives, or persists its own version of a record without going through the source of truth.
3. **Persist** MegaData durably to Google Drive, append-only, with per-page derived data kept in its own folder tree, so nothing is ever lost or erased.

Do not begin coding until Phase 1 and Phase 2 are complete and I have signed off on the architecture.

---

## 2. Phase 0 — Ground Truth Discovery (no code changes)

Before you touch anything, produce a written inventory. Read the actual repository — do not assume, do not infer from file names, open the files.

Deliver `docs/00-INVENTORY.md` containing:

- **Page/module map** — every HTML page, script, and sub-system, with its purpose in one line.
- **Data map** — for each page: what it *reads*, what it *writes*, where it writes (localStorage, sessionStorage, IndexedDB, JSON file, in-memory, Drive, server, hardcoded), and in what shape.
- **Entity map** — every distinct real-world entity the platform tracks (student, enrolment, course, cohort, class session, attendance record, assessment, grade, fee invoice, payment, receipt, staff member, certificate, etc.), and every *different* shape that entity takes across the codebase.
- **Divergence register** — a numbered table of every concrete way two sub-systems can disagree. For each row: the two locations, the field(s), the mechanism of divergence, a reproduction path, and severity (Critical / High / Medium).
- **Derived-data register** — every value a page *computes and then stores* rather than reading from source (e.g. a page that calculates outstanding balance and saves it). These are the primary bugs; list them all.
- **Silent-write register** — every place a page creates or mutates a record without a corresponding write to a canonical store.
- **Data-loss risks** — every place data can be overwritten, truncated, reset, or clobbered by a concurrent write or a page reload.

**Phase gate:** present the divergence register and wait for my confirmation that it matches what I have been seeing in practice.

---

## 3. Phase 1 — LMS Domain Research

Research how mature LMS platforms model their data, and write `docs/01-LMS-RESEARCH.md`. Cover, with reasoning rather than a list of links:

- The canonical LMS domain model: the separation between **Person → Enrolment → Course/Programme → Cohort/Intake → Session → Attendance → Assessment → Result → Certification**, and why enrolment (not the student) is the correct anchor for most academic records.
- The **fees/financial sub-model**: why LMS and student-information systems use an **immutable ledger** (invoice lines, payments, adjustments, write-offs, refunds) rather than a mutable "balance" field, and why a balance must always be a *computed projection* of the ledger, never a stored number.
- **Single source of truth** patterns: canonical store + read models / projections; why UI components must be pure consumers.
- **Append-only / event-sourced** persistence: event log, snapshots, replay, and why this makes "nothing is ever erased" structurally true rather than a policy.
- **Idempotency and identity**: stable IDs, deterministic keys, deduplication, and how to avoid duplicate student records created by two pages.
- **Reconciliation**: how systems detect and repair drift between a canonical store and derived copies.
- **Referential integrity without a relational DB**: how to enforce it in a file/Drive-backed store.
- **Correction semantics**: corrections as reversing/superseding entries, never destructive edits; full audit trail (who, what, when, previous value, reason).
- Standards worth borrowing from even if we do not implement them fully: SCORM/xAPI for learning activity records, OneRoster for roster/enrolment interchange, double-entry bookkeeping for fees.

End the document with an explicit set of **design principles** you will hold the rest of the work to.

**Phase gate:** I sign off on the principles before you design.

---

## 4. Phase 2 — MegaData Architecture Design

Write `docs/02-MEGADATA-ARCHITECTURE.md`. Design, do not build yet.

### 4.1 Core requirements

- **MegaData is the single canonical dataset for the entire platform.** One authoritative record per real-world fact. Every page reads from it and writes to it through one access layer.
- **No page may create, compute-and-persist, or mutate data outside this layer.** If a page needs a value it does not have, it asks the source; it never fabricates or re-derives and stores.
- **Every process gets its own record.** Every meaningful action — enrolment, payment received, attendance marked, grade entered, document generated, correction applied — produces its own immutable, timestamped, attributed record. These records then merge into the canonical projections; both the individual record and the merged result are saved.
- **Nothing is ever deleted or overwritten.** Deletion is a tombstone event. Correction is a superseding event. History is fully reconstructable.

### 4.2 Structure to design

- The **canonical schema** for every entity from the Phase 0 entity map — one schema per entity, versioned, with required fields, types, and ID strategy.
- The **event log** format: event type, entity type, entity ID, payload, actor, timestamp, source page/module, causation/correlation ID, schema version, content hash.
- The **projection/read-model** layer: how canonical state (e.g. a student's current fee balance) is computed from the log, when it is recomputed, and how it is cached without becoming a competing source of truth.
- The **Data Access Layer (DAL)** — the single API surface every page must use. Specify the exact function signatures (`getStudent`, `recordPayment`, `enrol`, `markAttendance`, …). No page touches storage directly after this refactor.
- **Validation gates**: nothing enters MegaData that fails schema validation, referential integrity, or business rules (e.g. a payment cannot reference a non-existent invoice).
- **Concurrency and conflict**: two pages writing at once, a stale tab, an offline tab that reconnects. Specify the resolution rule and prove it cannot lose a write.
- **Migration**: how existing scattered data is ingested into MegaData without loss, including how conflicting existing copies are reconciled and how the reconciliation decisions are recorded for audit.

**Phase gate:** I sign off on the architecture and DAL surface before implementation.

---

## 5. Phase 3 — Google Drive Persistence

MegaData persists to Google Drive.

### 5.1 Folder targets

- **Legacy / existing data source (read-only):**
  `https://drive.google.com/drive/folders/11vWe_Nc40TtJ1Hi7PoE7EZ3JrpR-K0Vj`
  The platform already holds real data here. This folder is the input to the bootstrap merge in Phase 4. **Treat it as read-only for the entire project.** Never write to it, never reorganise it, never delete from it. After cutover it becomes a frozen archive, retained permanently.

- **MegaData master store (root):**
  `https://drive.google.com/drive/folders/1-BVqRHL3bh0UB30pvlXt0AWAsKWsueec`
  Holds the canonical event log, snapshots, schemas, manifests, and the platform-wide merged dataset.

- **Per-page / per-module store (second-hand data):**
  `https://drive.google.com/drive/folders/1ddRM6zgTAupsYZzU7z2vbYXZhNQ6qx4B`
  **Every individual page/HTML sub-system gets its own folder here**, auto-created and named deterministically from the module ID. This is where all second-hand (derived, page-local, projected, exported) data is written — most importantly student records and fee records as each page sees them.

### 5.2 Rules

- **Append-only.** New files or new revisions; never destructive overwrite, never delete. Use dated/sequenced filenames plus a manifest.
- **Second-hand data is explicitly labelled as derived** and carries a pointer to the canonical event(s) it was computed from, plus the hash of the canonical state at computation time. It is a *record*, never an authority.
- **Reconciliation job**: compares every per-page folder against canonical MegaData and reports drift. Drift is a bug report, not a merge — canonical always wins, and the discrepancy is logged permanently.
- **Nothing lost**: durable write queue with retry, offline buffering, resume after failure, and a startup integrity check that verifies every queued write eventually landed.
- **Integrity**: checksum every file; maintain a manifest per folder with file list, hashes, record counts, and a running total for financial data so any tampering or truncation is detectable.
- **Fees specifically**: every invoice, payment, adjustment and receipt is written as its own immutable record *and* into the merged ledger. Reconcile the sum of individual records against the merged ledger on every sync; a mismatch is a hard failure that surfaces loudly, not a silent correction.

### 5.3 Implementation notes

- Reuse the existing `gdrive-sync.js` module if it is a fit; otherwise extend it rather than writing a parallel implementation.
- Google Drive API with OAuth. **Do not commit credentials, tokens, or client secrets to the repository.** Read them from environment/config and add them to `.gitignore`. Tell me exactly which scopes and credentials you need and how to provision them.
- Handle Drive API rate limits with exponential backoff.
- If you cannot reach the Drive API from your environment, build against a local filesystem adapter behind the same interface and tell me plainly which parts are untested against live Drive.

---

## 6. Phase 4 — Bootstrap, Merge and Cutover

The platform is **not** starting empty. It already holds real data, spread across the legacy Drive folder and whatever local/page-level stores Phase 0 uncovered. All of it must end up inside MegaData. Nothing may be lost in the transition.

Design and build a one-time **bootstrap sequence** that runs on first launch of the new build, before the platform is allowed to operate normally.

### 6.1 Trigger and safety

- Runs **once**, at first launch/login after deployment, gated by a persisted bootstrap-state marker — not by "is the store empty", which is unsafe.
- **Single-flight.** If two users log in at the same time, exactly one bootstrap runs; the others wait or are shown a maintenance state. Design the lock and tell me where it lives.
- **Resumable and idempotent.** If it is interrupted at any point — closed tab, network drop, API limit, crash — re-running continues from the last completed step and never double-imports a record. Every step is checkpointed.
- **Non-blocking for the user.** If the merge cannot complete inside a reasonable login wait, it runs as a visible background job with progress, not a frozen login screen. If you judge that this should be an admin-initiated job rather than a login-triggered one, say so in your Section 0 answer.
- **Full backup first.** Before a single write, snapshot the current state of everything — legacy Drive contents inventory, local stores, all existing data — into a dated, immutable backup. Bootstrap does not proceed until the backup is verified.

### 6.2 Bootstrap steps

Execute in this order, checkpointing after each:

1. **Pre-flight** — verify Drive access, credentials, scopes, quota, and write permission on both target folders. Abort cleanly with a clear message if anything is missing. Nothing is created on a failed pre-flight.
2. **Inventory** — enumerate everything in the legacy Drive folder and every local/page store. Record file names, sizes, hashes, record counts, and a total for anything financial. This inventory is the baseline that "nothing was lost" is later proved against.
3. **Extract** — parse every legacy source into a normalised staging form. Anything unparseable goes to a quarantine list; it is never skipped silently and never discarded.
4. **Identity resolution** — match records across sources into single real-world entities. Assign stable canonical IDs. Where a match is confident, merge it. **Where it is ambiguous, do not guess** — route it to a human adjudication queue and hold it there.
5. **Conflict resolution** — where sources disagree on the same field for the same entity, apply the documented precedence rule. Every conflict, its resolution, its reasoning, and the losing value are recorded permanently as audit records. **Financial conflicts are never auto-resolved** — every fee discrepancy goes to the adjudication queue for a human decision.
6. **Event synthesis** — convert the resolved dataset into the canonical event log. Each legacy record becomes one or more immutable events carrying provenance: which legacy file, which source system, which import run.
7. **Create the structure** — build the full folder tree: MegaData master store, and one folder per page/module in the per-page store. Write schemas, manifests, and the initial snapshot.
8. **Project** — compute all read models: balances, statuses, totals, enrolment states.
9. **Verify** — run the full reconciliation suite (Section 6.3). Bootstrap is not "complete" until it passes.
10. **Seal** — mark bootstrap complete, write the immutable import report, and only now permit normal operation.

### 6.3 Cutover gate — the conditions for abandoning the old paths

The legacy save paths may be retired **only** when every one of these is true and evidenced in writing:

- Record counts reconcile: every entity in the inventory from step 2 is accounted for in MegaData, as an imported record or an explicitly quarantined one. Zero unexplained gaps.
- **Financial totals reconcile exactly.** Sum of legacy invoices, payments, and adjustments equals the same sums in MegaData, to the cent, per student and in aggregate.
- The adjudication queue is empty — every ambiguous identity and every financial conflict has a recorded human decision.
- Every page reads exclusively through the DAL; the silent-write register from Phase 0 is empty.
- The full verification suite in Section 8 passes.
- A **shadow period** has run: for an agreed window, the platform writes to MegaData while the legacy paths remain in place read-only, and an automated comparison reports zero divergence. Propose the window length.

Until all of that holds, the legacy paths stay active and read-only. **Retiring them means disconnecting them, never deleting them** — the legacy Drive folder and the backup are retained permanently.

Deliver `docs/04-BOOTSTRAP-AND-CUTOVER.md`: the algorithm, the precedence rules, the checkpoint design, the lock design, the rollback procedure, and the exact cutover checklist with evidence slots.

**Phase gate:** I review the import report and sign off on cutover. The system does not retire the old paths on its own authority.

---

## 7. Phase 5 — Implementation

Implement in this order, committing at each step with a clear message:

1. Schemas + validation.
2. Event log + storage adapters (local and Drive) behind one interface.
3. Data Access Layer.
4. Projections / read models.
5. Bootstrap and legacy merge per Phase 4 — with a **dry-run mode** that reports the complete import plan, every conflict, and every ambiguous match *before* anything is written, and a verified full backup before the real run. I review the dry-run output first.
6. Refactor pages one at a time to consume the DAL. After each page, run the full test suite and confirm cross-page consistency before moving to the next.
7. Drive sync, per-page folder provisioning, manifests.
8. Reconciliation and integrity-check tooling, plus an admin view that shows sync status, drift, and any failed writes.

**Constraint:** at no point may the platform be left in a state where some pages use the DAL and others silently bypass it without that being explicitly flagged in your progress report.

---

## 8. Phase 6 — Verification

I do not want to see errors. Translate that into measurable gates and prove each one:

- `node --check` clean on every JS file, including JS embedded in HTML.
- Schema validation passes on 100% of migrated records; any record that cannot be validated is quarantined and reported, never dropped.
- **Cross-page consistency suite**: for a seeded dataset, assert that every page reports identical values for the same entity — student details, enrolment status, fee balance, payment history, attendance totals, grades. This suite is the direct test of the original problem; it must pass with zero tolerance.
- **Financial integrity suite**: sum of individual payment records equals merged ledger equals every page's displayed balance, across every student, before and after a Drive round-trip.
- **Durability suite**: kill the process mid-write, reload mid-sync, go offline and reconnect — assert zero records lost in every case.
- **Playwright end-to-end**: full user journeys (enrol a student → invoice → part-payment → correction → attendance → grade → certificate), asserting zero console errors and zero unhandled rejections throughout.
- **Round-trip test**: write to Drive, wipe local state, restore from Drive, assert byte-level equivalence of canonical state.
- **Bootstrap suite**: run the legacy merge against a copy of real data; assert full record reconciliation and exact financial reconciliation against the step-2 inventory. Then interrupt the bootstrap at every checkpoint boundary in turn, resume, and assert the final state is identical each time and that no record is imported twice.
- **Single-flight test**: trigger bootstrap concurrently from multiple sessions; assert exactly one import run occurs and the dataset is not duplicated.

Deliver `docs/03-VERIFICATION.md` with the actual output of every gate. If a gate fails, report the failure honestly rather than adjusting the test to pass.

---

## 9. Deliverables

- Your Section 0 feasibility verdict, in writing, before anything else.
- The five `docs/` files above, including the bootstrap/cutover document and the signed import report.
- The refactored platform, running clean.
- Bootstrap/merge tooling with dry-run, checkpointing, resume, backup, and rollback.
- The adjudication queue UI for ambiguous identities and financial conflicts.
- Reconciliation + integrity tooling.
- `README` covering setup, Drive credential provisioning, how to run each test suite, and how to add a new page correctly (i.e. the rules a future page must follow to stay inside the DAL).
- A final **residual risk list**: anything still fragile, untested against live Drive, or dependent on my configuration.

---

## 10. Rules of Engagement

- **Do not guess about my codebase.** Read the files. Where behaviour is ambiguous, ask me rather than assuming.
- **Ask before any destructive operation** — migrations, bulk rewrites, folder restructuring, deletions of any kind.
- **Report progress at each phase gate** and stop for sign-off.
- **Prefer boring, verifiable solutions** over clever ones. This system handles student fee records; correctness beats elegance every time.
- **If something cannot be done as specified, say so and propose the alternative** — do not silently substitute a weaker implementation.
- **Flag scope honestly.** If a phase is too large for one session, tell me where the natural break is instead of rushing it.
