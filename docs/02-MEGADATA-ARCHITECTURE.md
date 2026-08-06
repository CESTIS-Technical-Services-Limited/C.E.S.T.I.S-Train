# Phase 2 — MegaData Architecture

Design document. Nothing here is built yet. It implements the signed principles P1–P12
(`docs/01-LMS-RESEARCH.md`) under the signed constraints D1/D3 (zero-cost consumer Gmail, GitHub
Pages public repo) and the Section 0 amendments. Every design choice cites the Phase 0 register
entry it exists to fix.

---

## 1. Topology

```
┌─ Browser (each page, each device) ─────────────────────────────┐
│  Page UI  →  DAL (single API, sync reads / async writes)       │
│     │              │                                           │
│     │        In-memory projections  ←  Projection engine       │
│     │              │                                           │
│     └──────►  IndexedDB CESTIS_MEGA                            │
│               ├─ events   (local copy of the log)              │
│               ├─ outbox   (acknowledged, not yet durable)      │
│               ├─ snapshots / projection caches (provenanced)   │
│               └─ meta     (head seq+hash, basis stamps)        │
│  Leader tab (Web Locks) ⇄ BroadcastChannel to other tabs       │
└───────────────┬────────────────────────────────────────────────┘
                │ HTTPS (text/plain JSON + HMAC)
        ┌───────▼──────────────────────────────┐
        │  BROKER — Google Apps Script web app │   the ONLY Drive writer (P1)
        │  LockService mutex per append        │
        │  validate → assign seq → append      │
        └───────┬──────────────────────────────┘
                │ Drive API (broker's own auth)
        ┌───────▼──────────────────────────────────────────────┐
        │  Google Drive (school account)                       │
        │  MegaData master store  = append-only log + snapshots│
        │  Per-page store         = attestations + exports     │
        │  Legacy folders (×12)   = read-only bootstrap input  │
        └──────────────────────────────────────────────────────┘
```

Key inversions vs today, and what each kills:

1. **Clients hold no Drive tokens for MegaData.** All reads and writes go through the broker, so
   the two-token-store split (D15), the full-`drive`-scope-in-every-browser exposure, and the
   any-client-can-delete-the-store hazard disappear for the new system. (Legacy sync keeps its
   tokens until cutover; Qual-Plan's read-only Drive browsing is untouched.)
2. **One mutable file in the whole design** (`head.json`), written only by the broker under a real
   mutex — every LWW clobber class (D5, D8, D29, D30, L10) is structurally gone because nothing
   else is ever updated in place.
3. **Reads are local and synchronous** after page open (replica + projections), preserving the
   legacy pages' synchronous read style so the Phase 5 refactor is near-mechanical.

## 2. Identity and ID strategy (P5)

| Kind | Form | Minted by | Notes |
|---|---|---|---|
| Event id | `evt_<uuid7>` | client (or deterministically by migration: `evt_m<sha256-24(srcFileId|recordPath|transformV)>`) | globally unique; dedupe key everywhere (P10) |
| Entity ids | `per_ enr_ prg_ int_ ses_ att_ exm_ res_ crt_ stf_ acc_ doc_ cbe_ pay_ vir_ fdc_ tmr_ apr_ <uuid7>` | client at creation, inside the creating event | never derived from names (kills id churn/relink) |
| Sequence `seq` | integer, gapless, global | **broker only** | total order for the whole log |
| Human-facing numbers | receiptNo `R-000123`, certNo `CT-2026-0042`, invoiceNo, voucherNo | **broker only**, monotonic per series, assigned during append of the event that needs one | kills L9 (collisions), D17 (per-device certNos), duplicate invoice numbers |
| Import run id | `imp_<date>-<n>` | migration CLI | provenance on every migrated event |

Offline consequence, stated honestly: an offline-recorded payment has an event id immediately but
gets its `receiptNo` only at broker ack. The receipt UI prints the event id as a provisional
reference and re-prints/annotates with the receipt number on sync; the projection marks the row
"pending number". (At the Centre's connectivity this is rare; it is the honest price of P5.)

## 3. The event envelope (spec 4.2)

One JSON object per event, canonical serialization (sorted keys, UTF-8, integer minor units,
UTC ISO-8601 timestamps only, no floats, no NaN/Infinity):

```json
{
  "v": 1,
  "id": "evt_01J...",
  "seq": 12345,
  "type": "fees.payment.recorded",
  "schemaV": 1,
  "entity": { "kind": "enrolment", "id": "enr_01J..." },
  "refs": { "person": "per_01J...", "intake": "int_01J..." },
  "payload": { "amountMinor": 500000, "method": "cash", "term": 2, "reference": "" },
  "actor": { "account": "acc_01J...", "name": "…", "role": "admin", "device": "dev_…" },
  "at": "2026-08-05T14:03:22.118Z",
  "brokerAt": "2026-08-05T14:03:25.402Z",
  "source": "School.Fee",
  "cause": "evt_…",
  "corr": "cor_…",
  "prov": { "importRun": null, "srcFile": null, "srcPath": null },
  "hash": "sha256:…"
}
```

- `hash` covers the canonical serialization minus `seq`/`brokerAt`/`hash` (client-computable,
  broker-verified; P11).
- `cause` = the event that triggered this one; `corr` groups one user action's events.
- `at` is client wall-clock (display only); **ordering is `seq` alone** (client clocks are never
  trusted — the lesson of most-recent-timestamp merges, D8/D12).
- Numbers assigned by the broker are written into the stored payload at append
  (`payload.receiptNo`), and the ack returns them.

## 4. Two tiers of data (signed Section 0 amendment; P2 scoped)

**Tier A — event-sourced ledger domains** (the event *is* the business record; full catalogue §5):
fee ledger, cashbook, payroll runs, time clock, attendance, enrolment lifecycle, assessment
results, certification, identity merges, corrections, tombstones, finance documents' issue/void,
virement lifecycle, adjudication decisions.

**Tier B — versioned documents** (slowly-changing state; one generic event
`doc.upserted {kind, id, diff:{field:[old,new]}, reason}` gives the full audit trail without a
per-field event taxonomy): person bio fields, programme/intake catalogue, fee schedules' text,
staff records, accounts (minus secrets), settings, cert templates, unit catalogues, calendar,
announcements, resources metadata, chat messages (append-only docs, capped **views**, uncapped
log — L14 fixed), VC session summaries, support messages, ADR tasks, appraisals.

**Out of MegaData entirely:** UI state, drafts, dark mode, session tokens, OAuth tokens, per-page
caches, `examInProgress` scratch state. Generated PDFs are exports with provenance, not events.

## 5. Event catalogue (Tier A; payload field lists abbreviated, full JSON Schemas ship in Phase 5)

| Type | Payload core | Rules it enforces / bug it kills |
|---|---|---|
| `person.registered` | bio fields, ids minted | |
| `person.corrected` | diff + reason | D21 (bio in 4 places → one) |
| `person.merged` | winnerId, loserId, evidence, tier | audited merges (L11, P6); repoints via projection |
| `person.tombstoned` | reason | uniform deletion (L6) |
| `enrolment.created` | personId, programmeId, intakeId, start | the anchor (P3) |
| `enrolment.statusChanged` | to: active/completed/withdrawn/nyc, reason | replaces stage scalars (D24) |
| `enrolment.transferred` | toIntakeId, reason | |
| `fees.schedule.set` | programmeId/intakeId, totalMinor, terms[] | replaces `cestiFeeStructure` name-keyed map (D20) |
| `fees.charge.assessed` | enrolmentId, termNo, amountMinor, dueDate | charges become explicit (today implicit in tuitionFee) |
| `fees.payment.recorded` | amountMinor, method, date, receiptNo*, reference | immutable payment (D1, D7) |
| `fees.payment.reversed` | paymentEventId, reason | supersession, no in-place edits (§8 research) |
| `fees.adjustment.applied` | amountMinor(±), kind: waiver/discount/writeoff/correction, reason | discounts stop being tuition edits |
| `cashbook.entry.recorded` | date, kind: income/expense, categoryId, amountMinor, chequeNo*, payee | **client decision D11: the cashbook is a separate book from school fees — no fee-payment link, by design** (Phase 0 D4 reclassified as intentional) |
| `cashbook.cheque.voided` | entryEventId, reason | void as supersession (D8 edit class) |
| `cashbook.quarter.opened` | fy, q, openingBalanceMinor **computed by fold, recorded as checkpoint** | D9: never hand-set |
| `budget.set` / `virement.requested/approved/rejected` | … | approval **writes the budget change** (D10) |
| `findoc.issued/superseded/voided` | kind, number*, parties, lines | doc numbers broker-assigned (L9) |
| `payroll.run.recorded` | month, per-employee lines (all Minor), rateTableVersion | one formula, versioned rates (D11) |
| `payroll.line.corrected` | runEventId, employee, diff, reason | |
| `time.clockedIn/out` `time.corrected` | staffId, at / diff+reason | corrections are events → they SYNC (L7) |
| `attendance.marked` | enrolmentId, date, status, sessionId? | one attendance truth (D18) |
| `attendance.corrected` | markEventId, newStatus, reason | |
| `assessment.result.recorded` | enrolmentId, examId, score, breakdown | |
| `assessment.result.overridden` | resultEventId, grade, reason | original survives (D16) |
| `cert.approved` / `cert.issued` / `cert.collected` | enrolmentId; certNo* on issue | per-enrolment (kills one-approval-per-student, D17) |
| `identity.adjudicated` | queueItemId, decision, actor, evidence | the human queue is itself in the log |
| `doc.upserted` / `doc.tombstoned` | Tier B generic | |
| `admin.noteAppended` | freeform, entityRef | escape hatch that is still an event |

`*` = broker-assigned number series.

## 6. Canonical entity schemas (projection shapes; one per Phase 0 entity, versioned `schemaV`)

Abbreviated to identity + required fields; full JSON Schemas are a Phase 5 step-1 deliverable.

- **person** `{id, names{full, normalized}, dob?, gender?, nationalId?, contacts{phone,email,address,city}, guardians[], flags{keepSeparateFrom[]}, v}`
- **programme** `{id, name, level, nvqCode?, aliases[], v}` · **intake** `{id, programmeId, label, start, end, fiscalYear, capacity?, v}`
- **enrolment** `{id, personId, programmeId, intakeId, status, enrolledAt, completedAt?, v}`
- **feeSchedule** `{id, intakeId|programmeId, totalMinor, terms[{no, amountMinor, dueDate?}], v}`
- **ledger row (projection)** `{enrolmentId, entries[{eventId, kind, amountMinor, date, meta}], chargedMinor, paidMinor, adjustedMinor, balanceMinor}` — *never stored as authority; always a fold* (P4)
- **cashbookEntry** `{id, fy, q, date, kind, categoryId, amountMinor, chequeNo?, payee, sourceEventId?, voidedBy?}` · **budget** `{fy, q, lines[{categoryId, sectionId, amountMinor}]}`
- **staff** `{id, personRef?, names, employment{designation, type, startDate}, statutoryIds{trn, nis}, v}` (statutory ids live only in the store, never in the repo)
- **payrollRun** projection of run events; **timeRecord** `{id, staffId, date, in, out?, breaks[], correctedBy[]}`
- **exam** `{id, intakeId|programmeId, title, date, passMark, questions v-doc}` · **result** projection incl. overrides chain
- **certificate** `{id, enrolmentId, certNo, issuedAt, collectedAt?, templateId}` · **certTemplate** Tier B doc
- **account** `{id, personId?, staffId?, role, username, email, credentials{pbkdf2}, twoFactor{…}, status, v}` — one store (kills the four credential stores, D12/D18); secrets never leave the store
- **request** `{id, enrolmentId, type, status, handledBy?, …}` · **unitCatalog / transcriptProfile** Tier B
- **findoc** `{id, kind, number, status, parties, lines[amountMinor], revisions[]}` · **virement** `{id, fy, q, lines[], status, approvedBy?}`
- Tier B comms entities (chat room/message, announcement, calendarEvent, notification, resource, meeting, vcSessionSummary, appraisal, adrTask, supportMessage) keep their Phase 0 §3 shapes, re-keyed to minted ids, with money/none and caps applied to views only.

## 7. The DAL — the single API surface (spec 4.2; exact signatures)

Loaded as `cestis-dal.js`; global `CESTISData` (`DAL` below). **Reads are synchronous** after
open; **writes are async**, resolve at local-durable ("accepted"), and expose `.durable` for
broker ack. No page touches `CESTISStore`, IndexedDB, localStorage, or Drive after refactor —
enforced by the runtime shim (§12).

```js
// lifecycle ----------------------------------------------------------------
await DAL.open({ page, actor })            // hydrate replica, elect leader, start sync
DAL.head()             // → { seq, hash, syncedAt, unsynced }   (P7 provenance)
DAL.close()

// generic ------------------------------------------------------------------
DAL.get(kind, id)                          // → entity projection | null   (sync)
DAL.find(kind, query)                      // → [entities]                 (sync, indexed)
DAL.project(name, params)                  // → named read-model result    (sync)
DAL.subscribe(name, params, cb)            // re-fires on head advance     (returns unsubscribe)
await DAL.appendDoc(kind, id, diff, reason)        // Tier B upsert (audited)

// people & enrolment -------------------------------------------------------
DAL.getPerson(id); DAL.findPeople({ name?, nationalId?, phone? })
await DAL.registerPerson(bio)                       // → { personId, eventId, duplicates:[suggested] }
await DAL.correctPerson(personId, diff, reason)
await DAL.enrol(personId, intakeId, opts)           // → { enrolmentId }
await DAL.setEnrolmentStatus(enrolmentId, status, reason)
await DAL.transfer(enrolmentId, toIntakeId, reason)
await DAL.requestMerge(winnerPersonId, loserPersonId, evidence)  // → queue item (P6: humans decide)

// fees ---------------------------------------------------------------------
DAL.getLedger(enrolmentId)                 // → ledger projection (entries + balanceMinor)
DAL.getBalance(enrolmentId)                // → integer minor units (fold, never stored)
await DAL.setFeeSchedule(scopeRef, { totalMinor, terms })
await DAL.assessCharge(enrolmentId, { termNo, amountMinor, dueDate })
await DAL.recordPayment(enrolmentId, { amountMinor, method, date, reference })
        // → { eventId, receiptNo|pending }   .durable → { receiptNo }
await DAL.reversePayment(paymentEventId, reason)
await DAL.applyAdjustment(enrolmentId, { amountMinor, kind, reason })

// attendance / assessment / certification ---------------------------------
await DAL.markAttendance(enrolmentId, date, status, sessionId)
await DAL.correctAttendance(markEventId, newStatus, reason)
await DAL.recordResult(enrolmentId, examId, resultPayload)
await DAL.overrideResult(resultEventId, grade, reason)
await DAL.approveCertificate(enrolmentId)
await DAL.issueCertificate(enrolmentId)             // → { certNo }
await DAL.recordCollection(certificateId)

// finance / payroll / time -------------------------------------------------
DAL.getQuarter(fy, q)                      // → cashbook projection (entries, budget, folds)
await DAL.recordCashbookEntry(entry)                // separate book from fees, by design (D11)
await DAL.voidCheque(entryEventId, reason)
await DAL.setBudget(fy, q, lines); await DAL.submitVirement(v); await DAL.decideVirement(id, decision, pin)
await DAL.issueDoc(kind, doc)                       // → { number }
await DAL.supersedeDoc(docId, diff, reason); await DAL.voidDoc(docId, reason)
await DAL.recordPayrollRun(month, inputs)           // one calc path, versioned rate table
await DAL.clockIn(staffId); await DAL.clockOut(staffId)
await DAL.correctTimeRecord(timeRecordId, diff, reason)

// adjudication & admin ------------------------------------------------------
DAL.adjudications.list(filter)             // identity + financial queues (sync)
await DAL.adjudications.decide(itemId, decision, note)
DAL.sync.status()                          // { head, unsynced, brokerReachable, lastError }
await DAL.sync.now()
DAL.integrity.report()                     // last verifier output (sync)
```

Write pipeline (every `await DAL.*` command): validate locally (schema + refs against replica +
business rules) → build event(s) → **one IndexedDB transaction**: append to `events` + `outbox`,
update projections incrementally → resolve "accepted" → leader tab uploads outbox batch to broker
(at-least-once) → ack writes `seq`/numbers, clears outbox, advances head → BroadcastChannel
notifies all tabs (P10/P11 acknowledged-write contract, verbatim from the signed verdict).
Commands carry a `basis` (the head seq the UI acted on); the DAL rejects with
`STALE_BASIS` when the entity changed past the basis for compare-sensitive commands
(payment edit-adjacent flows), killing the row-index race class (L17).

## 8. Projection layer (spec 4.2)

- **Registry of named, pure, deterministic folds**: `roster`, `ledger(enrolmentId)`,
  `balances(intakeId)`, `quarter(fy,q)`, `attendanceTotals`, `resultsByEnrolment`,
  `certRegister`, `payrollYtd(staffId)`, `dashboardCounts`, `adjudicationQueues`,
  `driftReport`. No `Date.now()`, no locale, no floats, no iteration-order dependence
  (lint-enforced; rebuild-twice CI gate).
- **Caching without competing truth (P7):** caches live in `CESTIS_MEGA.projections` keyed
  `{name, params, basisSeq, basisHash}`; a cache is *only* valid at its exact basis; head advance
  → incremental apply of the tail (folds are written as `init/apply(event)/value`), full rebuild
  on schema bump. Caches are never uploaded, never merged, never read by another device.
- **Cold start:** local replica hydrate; if empty → broker `snapshot` + `tail`. Warm start costs
  zero network. Snapshots are broker-produced every N=2,000 events or nightly.

## 9. The broker (Apps Script web app — the enforcement point)

Endpoints (POST text/plain JSON — Apps Script CORS constraint; deployed "anyone with link";
every request carries `{hmac, actorContext}`; documented weakness accepted in D1):

| Endpoint | Request | Response | Behaviour |
|---|---|---|---|
| `append` | `{events[], clientId}` | `{acks:{evtId:{seq, numbers?}}, head}` | `LockService.waitLock(20s)` → verify HMAC + hashes → **validate** (schema, refs vs integrity index, business rules, dedupe by event id — replays return the original acks: idempotent, P10) → assign seqs + numbers → append one JSONL **segment file** (immutable, `seg-<n>-<firstSeq>-<lastSeq>-<sha256>.jsonl`) → update `head.json` + integrity index → release |
| `pull` | `{sinceSeq, max}` | `{events[], head}` | serves tail from segment cache; clients never touch Drive |
| `headq` | `{}` | `{seq, hash}` | cheap poll (leader tab, 20–30 s, visibility-gated) |
| `snapshot` | `{}` | latest snapshot ref + inline chunks | cold start |
| `gate` | `{op:'bootstrapState'\|'maintenance', …}` | state | single-flight gates live behind the real mutex (verdict Q3) |

- **Integrity index** (broker-private JSON, updated under the same lock): live entity ids per
  kind, number-series counters, per-enrolment `{chargedMinor, paidMinor, adjustedMinor}` sums,
  last N event ids for fast dedupe. This is what makes referential/business validation O(1)
  instead of a replay — it is itself rebuildable from the log (P7 applies to the broker too).
- **Validation gates (spec 4.2):** JSON Schema per `type@schemaV`; refs must exist and not be
  tombstoned; money rules (`amountMinor` integer, reversal ≤ original, payment requires live
  enrolment);
  quarantine responses name the exact rule violated. Nothing invalid is ever appended (P8).
- **Failure modes, stated:** broker down → clients keep accepting writes into the outbox
  (bounded only by storage; UI shows the unsynced counter), reads serve the local replica;
  broker quota exhausted (6-min exec cap, ~30 concurrent) → 429 + backoff; segment write
  succeeded but ack lost → client retry is deduped by event id (the classic case, tested).
  Broker code lives in this repo (`broker/`) and is deployed manually; the HMAC secret is
  provisioned in Script Properties, never committed (D3).
- **Capacity check:** Centre scale ≈ tens of writes/minute peak. One append round-trip 1–3 s
  serialized ⇒ ~20–40 batched appends/min sustained — an order of magnitude of headroom; batching
  (outbox drains many events per call) multiplies it.

## 10. Drive layout (spec 5.1 folders, reconciled with Phase 0 reality)

```
MegaData master store (1-BVqRHL…)            ← spec's folder; already holds the legacy
  cestis-master-snapshot.json                  master snapshot — LEFT UNTOUCHED until cutover
  MegaData/
    log/       seg-000001-…jsonl …            immutable, hash-chained (each names its
    head.json                                  predecessor's hash), broker-only
    snapshots/ snap-<seq>-<hash>.json
    schemas/   eventschemas-v1.json
    manifests/ manifest-<date>.json           dated, append-only (P11); running financial
                                              folds recorded by the RECONCILER, never
                                              maintained by clients (verdict amendment 4)
    import/<runId>/  inventory.json  plan.json  decisions.jsonl  report.json
Per-page store (1ddRM6…)                      ← unused today (verified) — clean home for
  attestations/<page>/att-<date>.jsonl          {page, projection hash, basisSeq, at}
  exports/<page>/…                              genuine artifacts + provenance pointers
Legacy folders (11vWe_… + 11 others)          ← READ-ONLY bootstrap inputs, then frozen archive
```

- **No Drive revisions are ever relied on; no file is ever edited except `head.json`**, whose
  single-writer-under-mutex property is exactly what raw Drive could not give us before.
- **Disaster recovery (inventory §8 gap):** a scheduled Apps Script time-trigger exports the
  current snapshot + head + last segments as a dated bundle into a second location (separate
  Drive folder + downloadable zip the admin is prompted monthly to store off-account); restore
  is replay. Account continuity per D5.

## 11. Concurrency & conflict (spec 4.2) — the resolution rules

- **Two pages/devices writing at once:** both append; broker serializes; facts union — no
  conflict exists at the fact level (P10). Derived state recomputes identically everywhere.
- **Same real-world payment entered twice offline:** both events are valid facts; the ledger
  shows both; a **duplicate-suspect rule** (same enrolment, amount, date, different devices,
  within 48 h) flags a financial adjudication item; a human resolves via
  `fees.payment.reversed` — never auto (spec rule, kept).
- **Tier B document races:** per-field newest-`seq`-wins with the losing value preserved in the
  event history; identity fields never auto-merge (P6).
- **Stale tab:** `STALE_BASIS` rejection + re-render from head (D14-class impossible: there is no
  wholesale in-memory array to save back).
- **Offline tab reconnects:** outbox drains (at-least-once + dedupe), pull advances head,
  projections re-fold; nothing merges "back" from projections (P9).
- **What cannot be lost / what can (honest contract, verbatim from Section 0):** an accepted
  write survives crash/reload/offline and uploads at-least-once with dedupe; a write on a device
  whose storage dies before upload is lost — the UI's unsynced counter and
  `navigator.storage.persist()` bound the window; optional synchronous mode
  (`{confirm:'durable'}` option on `recordPayment`) holds the receipt until broker ack for
  large amounts.

## 12. Keeping pages honest (P1 enforcement; spec §7 constraint)

A first-loaded shim captures `Storage.prototype` methods and `indexedDB.open`, hands the
originals only to the DAL, and replaces the globals with versions that **log (migration mode) or
throw (enforced mode)** per page; direct `googleapis.com` fetches outside the DAL are flagged.
The per-page mode file is the migration progress report; "silent-write register is empty" (6.3)
is operationally defined as zero shim violations across the full Playwright suite in throw mode.

## 13. Migration fit (design summary — full algorithm is Phase 4's document)

Sources: the 12 legacy Drive folders, every browser's local stores (in-app export step), and any
`Offline System/data/` folders. Staging: local SQLite in the operator-run CLI. Every migrated
record becomes Tier A/B events with deterministic ids and full provenance; identity tiers and the
per-field precedence table (atomic beats derived; source ranking; timestamps only as tie-breaks)
per the signed verdict; legacy stored balances imported as verification fixtures only; financial
conflicts and Tier B identity questions land in the adjudication queue **as events**, so the
queue itself is auditable. The bootstrap-state marker and single-flight gate live behind the
broker's LockService (`gate` endpoint) — the one real mutex in scope.

## 14. What each page becomes (refactor map for Phase 5, ordered read-mostly → fees-last)

| Page | Reads become | Writes become |
|---|---|---|
| Student-Progress | `roster` projection | register/correct/enrol/transfer/tombstone commands |
| Transcript-Grades | `resultsByEnrolment` | `overrideResult`, catalogue Tier B upserts |
| Cert pages | `certRegister` | approve/issue/collect commands |
| School.Fee | `ledger`/`balances` | schedule/charge/payment/adjustment commands |
| Cashbook | `quarter(fy,q)` | `recordCashbookEntry`/`voidCheque` — an independent book; nothing flows in from the fee ledger (D11) |
| Virement | `quarter` + `virements` | submit/decide (decide writes the budget) |
| Payslip | `payrollYtd` | `recordPayrollRun` (+ Tier B employees) |
| Clock-in | `timeRecords` | clockIn/out/correct |
| index.html views | named projections each | respective commands |
| Offline System | **retired as a fork**: replaced by the same build + a local broker variant (same endpoints served by `cestis-offline-server.js`) — one codebase (P12), same log semantics on LAN |

## 15. Residual risks accepted at this gate

1. Broker is a SPOF with weak (HMAC) caller auth — accepted under D1; offline outbox bounds the
   blast radius; all invariants remain verifiable from the log.
2. Apps Script quotas are generous for this scale but unversioned by Google; the client keeps
   working offline-first if they tighten.
3. `actor` claims are client-asserted (no real per-user server auth on consumer Gmail) — the
   audit trail is honest about *what* happened; *who* is as trustworthy as the shared secret.
4. Provisional receipt numbers offline (§2) — operational note for clerks.
5. Git history still contains the scrubbed PII until the coordinated rewrite (D8).

---

**Phase gate:** sign-off requested on this architecture and the DAL surface (§7) — after which
Phase 5 implementation starts at step 1 (schemas + validation), with Phase 4's
bootstrap/cutover document written alongside. Changes to the DAL surface after pages are
refactored are the expensive kind; changes now are free.
