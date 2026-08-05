# Phase 1 — LMS Domain Research

How mature learning-management and student-information systems model their data, and what that
implies for MegaData. Every section closes the loop against the Phase 0 inventory
(`docs/00-INVENTORY.md` — divergence register D1–D32, loss register L1–L23), because the point of
this research is not academic: each pattern below exists to kill a specific bug class CESTIS already
has. The document ends with the design principles the rest of the project is held to.

---

## 1. The canonical LMS domain model — and why enrolment is the anchor

Mature systems (Moodle, Canvas, Open edX, Banner/PeopleSoft-class SIS, and the OneRoster
interchange model they all map onto) converge on the same spine:

**Person → Enrolment → Programme/Course → Cohort/Intake → Session → Attendance → Assessment →
Result → Certification.**

The load-bearing decision in that spine is that **almost nothing academic hangs off the person; it
hangs off the enrolment** — the (person, programme, intake) relationship, reified as a first-class
record with its own identity and lifecycle (applied → enrolled → active → completed/withdrawn →
certified). The person record holds only what is true of the human independent of any programme:
name, birth date, contacts, national identifiers.

Why enrolment and not student:

1. **One human, many enrolments.** A trainee finishes Welding L2 and starts Welding L3, or takes
   Cosmetology and a short course in the same year. If grades, attendance, fees and certificates
   attach to the *student*, the model cannot say which programme a payment or a grade belongs to —
   it collapses the person's history into one bucket. CESTIS is living this today: D16 (four
   competing "grade" fields on the student), D17 (one certificate approval per student, so a
   second programme's approval is destroyed — `dedupeCertDownloadApprovals` keeps one per
   studentId), D1 (a single `balance` on the student even though fees are per-programme-per-term).
2. **Identity disputes stop poisoning history.** When two student records turn out to be the same
   person (or one turns out to be two people), enrolments are re-pointed at the right person
   record; the enrolment-anchored facts (payments, attendance, results) do not move at all. In the
   current system a student merge rewrites or deletes payments (D6: merged-away students orphan
   their payments with no tombstones) precisely because facts hang off the student id.
3. **The intake is the natural scope for reporting.** "The 2025/26 Welding L2 cohort" is what the
   Centre actually reports on. CESTIS already discovered this empirically — the enrolment-stamp
   fields (`centreKey`, `fiscalYear`, `courseStart/End`) bolted onto students, and the
   intake-collapse/`twinIndex` machinery, are an enrolment entity trying to be born inside the
   student record.

**Mapping to CESTIS:** Person = the deduplicated human. Programme = what `skillAreas`/fee-structure
keys describe. Intake = programme + start/end + fiscal year (what "training centre" records
actually encode). Enrolment = the missing entity that currently exists only as stamps on the
student and as the LMS↔fee twin-link (`lmsId`/`schoolFeeId`). Session/Attendance, Exam/Result,
Certificate all re-anchor from (studentId) to (enrolmentId).

## 2. The fees model — an immutable ledger, never a stored balance

Every serious student-billing system — and all of double-entry bookkeeping since the fifteenth
century — models money as an **append-only ledger of dated, signed entries**: charge (invoice
line), payment, adjustment/waiver, write-off, refund. A **balance is a fold over the ledger**
(Σ charges − Σ payments − Σ adjustments), computed at read time or in a rebuildable projection.
The balance is *never a stored, editable field*, for four reasons that are each visible in the
Phase 0 registers:

1. **A stored balance can disagree with its own evidence.** D1/D2 are exactly this: the stored
   `balance/totalPaid/status` trio versus the payments list, with a memorialised J$29,000 gap and
   27 phantom "Fully Paid" trainees. A computed balance *cannot* disagree with the payments — the
   disagreement class is structurally unrepresentable.
2. **Concurrent increments don't merge.** `totalPaid += amount` on two devices loses one increment
   under any merge rule. Appending two payment records and folding merges perfectly — addition is
   commutative; increments to a shared cell are not.
3. **Corrections need history.** Editing a payment in place (the current `savePaymentEdit`, with
   "zero audit trail" — Phase 0 §4-fees) destroys the evidence a fee dispute needs. Ledger systems
   never edit: they append a reversing entry and a corrected entry (§8 below).
4. **Auditability is the product.** For a fee-collecting institution, "show me every event that
   produced this number" is the actual requirement; a stored scalar answers it with silence.

**Double-entry, borrowed proportionately.** Full double-entry (every entry debits one account and
credits another, Σdebits = Σcredits invariant) is more machinery than a training centre needs
day-to-day, but two of its ideas are non-negotiable here: (a) every movement of money is an
immutable dated entry with an account/category dimension, and (b) **reconciliation is an
arithmetic identity, not a report** — the fee ledger's payments for a period must equal the
cashbook's fee-income entries for that period *by construction*, which finally gives D4 (fee
income ↔ cashbook: no linkage) a join: a fee payment event *is* the source record from which the
cashbook's income line is projected, not a fact staff re-key by hand. The cashbook's own entries
(salaries, utilities, subvention) are the same ledger pattern one level up — which also dissolves
D9 (stored opening balances) into "opening balance is the fold of prior quarters" and D11
(payroll↔cashbook double-entry-by-hand) into two projections of one payment event.

**Money representation:** integer minor units (cents) end-to-end. The current floats
(`parseFloat` + `toFixed(2)` everywhere) make to-the-cent reconciliation gates flaky by
arithmetic alone.

## 3. Single source of truth: canonical store + read models, UI as pure consumer

The pattern every mature system converges on (CQRS in its modest, non-dogmatic form): one
**canonical store** that is the only thing anyone writes to, and any number of **read
models/projections** — precomputed, denormalised views shaped for a page — that are *derived,
disposable, and rebuildable*. The rules that make it work:

- **Pages never write what they display; they command.** A page submits "record payment
  P against enrolment E" to the data layer; it never persists the table it rendered. Phase 0's
  silent-write register shows the opposite today: renders that write (`renderCertDownloadMgmt`,
  attendance dedupe in the renderer), loads that normalise-and-save (School.Fee's six load-time
  normalisers), and per-page copies uploaded as if authoritative.
- **A projection carries its provenance.** Every cached/derived artifact records the canonical
  position (event sequence number + hash) it was computed from. That single habit converts "is
  this stale?" from a guess into a comparison — and it is what the spec's per-page folders become
  (attestations, not second truths; Section 0 verdict amendment 6).
- **Derived data is labelled derived and can never win a merge.** The current system's worst
  incidents are derived copies (stored balances, mirrored quarter caches, per-page uploads)
  re-entering as if primary (D5, D10, D29, D30).

## 4. Append-only, event-sourced persistence — what it buys and what it costs

An **event log** records every state change as an immutable, timestamped, attributed fact
("PaymentRecorded", "AttendanceMarked", "StudentDetailsCorrected"). Current state is a **fold**
of the log; **snapshots** cache the fold at a position so cold start is snapshot + tail, not
full replay; **replay** rebuilds any projection from scratch, deterministically.

Why this is the right shape *here* (and not merely fashionable):

- **"Nothing is ever erased" becomes structural, not policy.** Deletion is a tombstone event;
  correction is a superseding event; the log only grows. The platform half-knows this already —
  it has tombstones for exactly four entity families and resurrection bugs everywhere it doesn't
  (L6). Event sourcing is that idea applied uniformly.
- **Immutable events are what Google Drive can actually store safely.** Drive has no transactions
  and last-writer-wins updates; immutable, uniquely-identified event segments are the one write
  pattern that cannot lose data to a concurrent writer (Section 0 verdict, Q2). Event sourcing is
  not just the domain model — it is the *only* storage discipline under which the chosen
  infrastructure is safe.
- **Merges become unions.** Two devices' event sets merge by set-union + dedupe-by-id + replay —
  no field-level conflict rules for facts, because facts don't conflict; only *derived* state
  does, and derived state is recomputed, not merged. This retires the entire zoo of bespoke merge
  disciplines in D5/D8/D29/D30.

Honest costs, and the containment for each (carried over from the signed Section 0 verdict):

- **Events are forever-contracts.** Schema evolution needs versioned events + upcasters kept
  alive permanently, tested against a frozen corpus. Contained by event-sourcing only the ledger
  domains (fees/cashbook/payroll movements, enrolment lifecycle, attendance, results,
  corrections, tombstones) and keeping slowly-changing entities as versioned documents with a
  generic audited-diff event.
- **Projections must be deterministic** (no wall-clock, no randomness, no locale, no float
  drift) or replay and incremental application diverge. Enforced by lint + a rebuild-twice gate.
- **Cold start must not replay from the network.** Snapshots from day one; local replica is the
  read primary.
- **UI/ephemeral state stays out** (drafts, filters, dark mode, tokens — the Offline System's
  exclusion list is already correct on this point).

## 5. Idempotency and identity

- **Stable IDs are minted once, from randomness, never from meaning.** Name-derived hashes
  (`stableStudentId(name|course)`) make identity mutate when a typo is fixed — the current id
  churn/relink machinery exists to chase this. Random ids (UUIDv7-style, time-ordered,
  crypto-random — `cestisGenId` is already right) never move; human-facing numbers (receipt,
  certificate, invoice) are *labels assigned by the canonical layer*, not identities, and never
  minted client-side by `Date.now()`/`rand4` (L9: payment-id collisions, duplicate invoice
  numbers, per-device certificate numbers).
- **Idempotency keys make retries and re-runs harmless.** Every event carries a globally unique
  event id; every projection dedupes by it. Migration events derive their ids deterministically
  from the source record (file id + natural key + transform version), so a re-run *converges*
  instead of double-importing — this is the correctness mechanism that replaces the impossible
  bootstrap lock.
- **Duplicate people are prevented at the write gate, resolved by humans, and repaired by
  re-pointing.** The one entry point (DAL) checks candidate matches at creation (exact strong
  identifiers only — the same tiering signed off in the Section 0 verdict: fuzzy similarity may
  *suggest*, never auto-merge, because a false merge in an append-only log is near-irreversible
  while a false split is a cheap later merge event). Merges themselves are events
  (`PersonMerged{winner, loser, evidence}`), so they are audited and reversible-by-supersession —
  unlike today's in-place collapse that risks merging two real trainees who share a name (L11).

## 6. Reconciliation: how drift is detected and repaired

Canonical-plus-derived only stays honest if drift is *looked for*:

1. **Continuous, cheap:** every page/tab attests `(projection hash, log position)`; a comparator
   flags any attestation whose hash disagrees with the canonical fold at that position. Detection
   cost is a hash compare, and a mismatch names the exact divergent consumer.
2. **Periodic, arithmetic:** financial identities recomputed from atoms — Σ payment events =
   ledger projection = every page's displayed balance, per student and aggregate, to the cent;
   fee-income projection = cashbook income lines. Run on every sync and nightly; **a mismatch is
   a loud hard failure, never a silent correction** (the spec's rule, kept verbatim).
3. **Repair is one-directional.** Canonical wins; the derived copy is rebuilt; the discrepancy is
   logged permanently as a bug report. Merging "back" from a derived copy is what turned the
   current per-page uploads into competing truths.
4. **Nothing silently caps or trims.** Today's caps propagate to the cloud (L14: chat's 500/room
   trim shrinks the Drive copy). Projections may window; the log never does.

## 7. Referential integrity without a relational database

No foreign keys will enforce anything on Drive/IndexedDB, so integrity moves into the **write
path and the verifier**:

- **One gate.** All writes pass through the DAL → broker; the broker validates *before append*:
  schema (versioned, per event type), references (a payment names an existing enrolment; a grade
  names an existing result/unit), and business rules (no payment against a closed enrolment
  without an adjustment). Invalid input is rejected at the gate, not discovered downstream — and
  because the broker is the only Drive writer, "every client validates" stops being a hope.
- **Creation-ordering discipline.** Events referencing an entity carry the entity's id, and the
  log guarantees the referenced creation event sorts earlier (broker assigns monotonic
  sequence). Replay therefore never sees a dangling reference *forwards*.
- **Tombstones are referenced-checked.** Deleting (tombstoning) an entity with live dependents
  is refused or cascades explicitly — today's silent orphaning of payments (D6) becomes
  impossible at the gate.
- **The integrity checker replays and audits:** every reference resolves, every projection
  matches its fold, every financial identity holds, every file's hash matches its manifest.
  It runs after sync, before cutover gates, and on demand — the without-RDB substitute for
  `CHECK` constraints is *a program that checks*.

## 8. Correction semantics

Corrections are **new events that supersede, never edits that overwrite**:

- `PaymentReversed{originalEventId, reason, actor}` + `PaymentRecorded{corrected}` — the fold
  yields the corrected balance; the history shows both the mistake and the fix (contrast:
  today's in-place payment edit with no trace).
- `StudentDetailsCorrected{field, oldValue, newValue, reason, actor}` — the audit trail (who,
  what, when, previous value, why) is the event itself, not a side log that can be dropped.
- Grade overrides supersede (`ResultOverridden{resultEventId, newGrade, reason}`) instead of
  rewriting the exam result in place as Transcript-Grades does now (D16) — the original
  evidence survives.
- Tombstone + supersede is also the **undo** story: a wrong merge, a wrong deletion, a wrong
  correction each get a compensating event. Nothing in the operator's toolbox is destructive.

## 9. Standards worth borrowing from (not implementing wholesale)

- **OneRoster (1EdTech):** its entity graph — orgs, academicSessions (≈ intakes/terms), courses,
  classes, users, **enrollments as first-class**, results — is the industry's consensus answer to
  §1, and its CSV/REST shapes are a sane target for future TMS/NQS interchange. Borrow: the
  entity boundaries and enrolment-centricity; also its `status + dateLastModified`-style
  soft-delete convention, which matches the tombstone model.
- **xAPI (Experience API):** `actor–verb–object` immutable statements with ids, stored in an
  append-only LRS, are exactly the event-log discipline of §4 applied to learning activity.
  Borrow: statement immutability, statement ids for dedupe, and `void` statements — xAPI's
  "deletion is a superseding record", identical to §8. (SCORM matters only if packaged e-learning
  content ever arrives; its data model is about content↔LMS runtime, not records, so: noted,
  not adopted.)
- **Double-entry bookkeeping:** §2. Borrow the immutable journal, the periodic *trial balance*
  as an automated gate (our financial identities), and reversing entries. Skip full
  debit/credit account trees until the Centre needs statements the cashbook projections can't
  produce.

## 10. Design principles (the contract the rest of this project is held to)

**P1 — One writer path.** Every durable business fact enters through the DAL and is appended by
the single serialized broker. No page touches storage or Drive directly; the runtime shim makes
bypass loud, then impossible.

**P2 — Facts are events; events are immutable; the log only grows.** Deletion is a tombstone
event, correction a superseding event, merge a merge event. History is reconstructable by
construction.

**P3 — Enrolment is the academic anchor.** Person holds the human; enrolment (person × programme
× intake) holds the academic and financial relationship; attendance, results, certificates and
fee lines hang off enrolments.

**P4 — Money is a ledger; balances are folds.** No stored balance, total, or financial status
anywhere, in any store, ever — integer minor units end-to-end; every financial identity
(payments↔ledger↔display, fees↔cashbook, payroll↔cashbook) is an automated, loud, zero-tolerance
check.

**P5 — Identity is minted, not derived.** Random stable ids; human-facing numbers are
canonically-assigned labels; every event carries a globally unique id and every consumer dedupes
by it (idempotency everywhere, including migration).

**P6 — Fuzzy never merges.** Automatic identity resolution only on exact strong identifiers;
everything else is suggested to a human; false splits are preferred to false merges; merges are
audited events.

**P7 — Projections are disposable and provenanced.** Every derived artifact records the log
position + hash it was computed from; it can never win a merge, never be an input to canonical
state, and must be rebuildable bit-identically (deterministic projectors, canonical
serialization).

**P8 — Validation happens at the gate.** Schema, referential and business validation run in the
broker before append; nothing invalid enters MegaData; quarantine, never silent drop.

**P9 — Drift is hunted, and canonical wins.** Hash attestations from every consumer, arithmetic
reconciliation on every sync, discrepancies logged permanently and surfaced loudly; repair is
rebuild-from-canonical, never merge-from-derived.

**P10 — Convergence over exclusion.** Where a lock cannot exist (browsers + Drive), correctness
comes from idempotent convergence: any interleaving or re-run of writers yields the same event
set. Locks are an optimization, never load-bearing.

**P11 — The wire and the disk are suspect.** Every persisted artifact is checksummed and
manifested; every read verifies; caps and trims apply to views, never to the log; acknowledged
writes are locally durable first and uploaded at-least-once.

**P12 — No second implementations.** One codebase per behaviour (the Offline System fork and the
embedded time-clock copy are migration targets, not patterns to repeat); one schema per entity,
versioned; one merge discipline (union + dedupe + replay) instead of five.

---

**Phase gate:** these twelve principles are the contract for Phase 2 (`02-MEGADATA-ARCHITECTURE.md`).
Sign-off requested on P1–P12 before any architecture is designed. Anything you reject or amend
here is cheap to change now and expensive after.
