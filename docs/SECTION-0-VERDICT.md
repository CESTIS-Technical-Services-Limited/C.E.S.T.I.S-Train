# Section 0 — Feasibility Verdict: LMS Unification & MegaData Layer

**Status:** Awaiting client response (this is the Section 0 gate — nothing below Phase 0 begins until you reply).
**Scope of what was examined:** Per your instruction, the codebase has not been read. The only repository actions taken were a root file listing (names and sizes) and git housekeeping to commit this document. Everything here is an assessment of the approach in `MEGADATA_SPEC.md`, informed by the environment the file listing implies: ~20 standalone HTML pages (several 300 KB–2.4 MB single files with embedded JS), shared JS modules, no visible server component, a consumer Gmail-operated Google Drive.

---

## Verdict

**Proceed — with these amendments.** The skeleton of the plan is sound and, in the places that matter most, professionally correct. But four load-bearing parts of the brief will fail as specified, and each needs the specific replacement described below:

1. **Google Drive as the *primary* datastore** — it must be demoted to the durable append-only log + archive, with a local replica for reads and a serialized write broker (or a small paid backend) as the enforcement point.
2. **The login-triggered, single-flight bootstrap merge** — a correct cross-user lock cannot be built on Drive; the merge must move out of the browser into an operator-run CLI job, with idempotent convergence (not a lock) as the safety mechanism.
3. **Client-maintained manifests with financial running totals** (spec 5.2) — this reintroduces the exact stored-derived-balance disease the spec elsewhere bans; manifests must be single-writer derived artifacts and totals must be computed, never maintained.
4. **Per-page derived-data folders persisting each page's view of students and fees** (spec 5.1/4.1) — this institutionalizes N+1 copies of the truth, the very disease the project exists to cure. Replace with per-page *attestation records* (content hash + log position) and a genuine-exports-only area.

There is also one uncomfortable observation the brief demands I make: a large fraction of the hardest problems in this design are self-inflicted by the zero-infrastructure / consumer-Gmail constraint, and lifting that constraint costs tens of dollars a month. That decision is yours, but it must be made knowingly — see "The constraint question" below.

---

## What the brief gets right (keep these verbatim)

Credit where due, because these are the bones the amended design stands on:

- **"A balance must always be a computed projection of the ledger, never a stored number."** Correct, and it is the cure for the platform's actual disease.
- **"Financial conflicts are never auto-resolved."** Correct. Keep it.
- **"Drift is a bug report, not a merge — canonical always wins."** Correct.
- The **10-step bootstrap order** (backup → inventory → extract → identity → conflict → synthesis → structure → project → verify → seal) is textbook-correct, including quarantine-never-silent-skip and seal-before-normal-operation.
- **Bootstrap gated by a persisted marker, not "is the store empty."** Correct instinct.
- **Dry-run before the real run**, with the client reviewing the full plan. Correct — and it should be elevated: the dry-run output *is* the Phase 4 gate artifact.
- **Shadow period before cutover; retiring means disconnecting, never deleting.** Correct (with one significant fix to the shadow design — see Answer 5).

---

## Answer 1 — Is a single append-only event log + computed projections the right shape?

**Yes for the ledger domains; no as a universal mandate. Proceed hybrid.**

The event-log-plus-projections shape is exactly right where the event *is* the business record: the fee ledger (invoice / payment / adjustment / refund / write-off), attendance, assessment results, enrolment lifecycle changes, corrections, and tombstones. At your scale (low thousands of students, single-digit concurrent staff), replay compute is never the bottleneck — a few years of events folds into projections in seconds.

Where full event sourcing costs more than it returns:

- **Every event type is a forever-contract.** Rewriting the log violates append-only, so every historical schema version needs a decode path kept alive permanently, tested against a frozen corpus of sample events. That tax is worth paying for money and grades; it is pure waste for a student's changed phone number.
- **Slowly-changing entities** (student demographics, course catalogue, staff records, settings) should be **versioned documents** plus one generic audit event carrying a field-level before/after diff — full audit trail, a fraction of the schema surface.
- **Keep out of MegaData entirely:** UI state, unsubmitted drafts, session tokens, per-page caches. Generated documents (certificates, receipt PDFs) are immutable *outputs* with provenance pointers, not events.

Non-negotiable disciplines that make the shape work:

- **Snapshots from day one**, not as a later optimization. Cold start = manifest + latest snapshot + tail; never a full log replay over the network.
- **Integer minor units for all money.** No floating point anywhere in an event payload or projection, or the to-the-cent gates in Section 8 will fail spuriously.
- **Deterministic projectors** — no wall-clock reads, no randomness, no locale-dependent formatting inside projection code — enforced by lint and a rebuild-twice-compare gate.
- **The multi-tab hazard is real and must be designed for**, or the project recreates its original disease at the tab layer: staff will have the fees page and the student page open at once, and each holds a cached projection. Design: one leader tab per device elected via the Web Locks API does all sync; tabs share an IndexedDB store; BroadcastChannel invalidation carries "log advanced to position N"; every projection carries the log position it reflects, so a stale tab is structurally detectable at the DAL boundary.
- **DAL shape that makes the 20-page refactor tractable:** load and verify projections once at page init, then expose *synchronous* reads over the in-memory projection with async queued writes. Legacy code written against synchronous `localStorage` reads can then be swapped near-mechanically.

**One environmental prerequisite to verify before Phase 2:** the cross-tab and shared-storage design assumes the platform is served from a single http(s) origin. If staff open these pages via `file://`, storage sharing, BroadcastChannel and Web Locks behave inconsistently or not at all. Tell me how the platform is actually served today.

---

## Answer 2 — Is Google Drive an adequate primary datastore?

**No as the primary system of record. Yes — genuinely good — as the durable append-only log and archive.** The distinction is not pedantic; it is the difference between a design that works and one that quietly corrupts fee data.

The facts, stated plainly (confidence flagged where not certain):

- **No transactions of any kind** across files, and no usable compare-and-swap on a single file in Drive API v3 — concurrent updates to the same file are last-writer-wins at whole-file granularity.
- **No exclusive create.** Drive permits multiple files with the same name in one folder; two clients both "creating the lock file" both succeed. Every lock protocol on raw Drive has a real race window, and there is no fencing token the store checks on writes, so a stale writer can never be safely excluded.
- **Listings can lag.** `files.get` by ID and `changes.list` with saved page tokens are dependable; query-based `files.list` can serve stale results. All tailing must use the changes feed.
- **Revisions are not history.** Drive auto-purges unpinned revisions of non-Google files (on the order of 30 days / 100 revisions), and pinned revisions are capped. The spec's "new files or new revisions" must become **new immutable files only**.
- **Throughput and latency.** Each upload is its own HTTP round trip (~300–1500 ms observed; the batch endpoint does not carry media). Sustained small-file creation before rate-limit storms is on the order of a few files per second per user (empirical, unverified — plan for ~3/sec with mandatory backoff, which the spec already requires). Fine for live operation at your concurrency; hours-scale for a naive file-per-event bootstrap — hence **writer-segment files** (batched JSONL), not one file per event, which also avoids the ~500 k items-per-folder cap and permanent listing pain.
- **OAuth reality.** Browser token flows yield ~1-hour access tokens with no refresh token. The full `drive` scope is a *restricted* scope (app-verification burden on a consumer account; apps left in "Testing" status expire refresh tokens after ~7 days). The narrower `drive.file` scope **does not work for a shared multi-writer folder** — files created by one staff member's session are invisible to another's app under that scope. So browser-direct Drive access forces the restricted scope onto every client. A broker makes this problem disappear: only the broker touches Drive.

What the append-only design genuinely rescues: immutable one-way writes never contend, duplicate creates deduplicate by event ID, and per-file atomicity means one business action = one atomic write. That is why Drive works *as the log*. What no client-side design can rescue:

- **No enforcement.** Every browser holding a Drive write token can — through a bug, a stale cached page, or a bad actor — violate append-only, skip validation, or **bulk-delete the entire MegaData folder in seconds** (trash auto-purges after 30 days). A system of record for money whose invariants are enforced only by the goodwill of every client is not a system of record.
- **File-ownership fragmentation.** In a shared consumer-Drive folder, each uploaded file is *owned by whichever staff account uploaded it* and counts against that account's quota. A staff member leaving, being suspended, or revoking sharing can silently orphan their slice of the event log — a direct violation of "nothing is ever lost." (Consumer accounts have no shared drives to fix this.)
- **Forgeable audit trail.** The `actor` field on every event is self-reported by an unauthenticated client. The adjudication records the spec leans on for financial decisions would be forgeable by any user.
- **Single point of failure.** One consumer Gmail account (lockout, suspension, forgotten password, 15 GB shared with Gmail/Photos) is the school's entire financial system of record. Independent periodic export to a second location must be part of the design regardless of everything else.
- **Confidentiality.** Student PII — plausibly including minors — and fee records would sit unencrypted in browser storage on staff machines and in a personal Gmail account, with no per-role read authorization. Adequacy as a system of record includes governance, not just durability. This needs an explicit decision from you, not a default.

**The recommended shape** (keeps your Drive folder layout exactly as specified in 5.1, in the demoted role):

1. **IndexedDB replica on each device = read primary.** All interactive reads are local and instant; sync runs in the background.
2. **A serialized write broker = the enforcement point.** Zero-infrastructure option: a Google Apps Script web app on the same Google account. Its `LockService` is a *real* mutex — the only genuine one in the free Google stack — letting the broker validate schema/referential integrity/business rules server-side, assign monotonic sequence numbers, own every file (killing ownership fragmentation), attribute writes, and enforce append-only. Honest caveats: ~1–3 s per call including cold starts, 6-minute execution cap, CORS restrictions that force text/plain payloads and an "anyone with the link" deployment secured by an HMAC shared secret — weak auth, but strictly stronger than every browser holding a raw Drive write token. The broker also becomes a single point of failure and needs an offline-queue story in the clients (which the outbox design in Answer 6 provides anyway).
3. **Drive = durable append-only log + archive**, written only by the broker (steady state) and the migration CLI (bootstrap), in exactly your three-folder layout.

**The constraint question.** I would be failing Section 0's own standard if I did not say this: roughly 80% of the hardest engineering in this document — the impossible lock, the HMAC-secured broker, ownership fragmentation, the restricted-scope OAuth burden — exists only because the platform must run on a free consumer Google account with no server. For context on what lifting it buys: Google Workspace (~US$6–7/user/month for a handful of staff) provides shared drives (single ownership) and domain-restricted Apps Script deployment (real auth); alternatively a managed Postgres (e.g. Supabase's free tier) or a ~$5/month VPS gives transactions, enforcement, and real authentication outright, with Drive kept as the durable mirror and human-readable archive — a strictly simpler and safer system. **I will build the zero-infrastructure version if that is your decision, but the decision should be made with this trade-off in front of you.**

---

## Answer 3 — Is "run the merge on first refresh/launch" a safe trigger?

**No, and it cannot be made safe. This should be an operator-run, checkpointed, resumable CLI job — not a login-triggered one, and not primarily an in-browser one.**

Three independent failure classes, any one of which is disqualifying:

1. **The single-flight lock has nowhere to live.** Drive offers no exclusive create and no compare-and-swap, listings can lag, and there is no fencing — so two simultaneous logins can both "acquire" any Drive-based lock, and a laptop that slept mid-merge can wake still believing it holds an expired one. Browser-side locks (Web Locks, localStorage) scope to one machine. There is no server. The spec asks "where does the lock live?" — the honest answer is *nowhere adequate exists in this stack* (the Apps Script broker's LockService is the one exception, if adopted).
2. **A browser tab is the wrong runtime for an hours-long job.** At realistic Drive throughput, synthesizing and uploading tens of thousands of events takes far longer than any login wait; the browser access token expires after ~1 hour with no refresh token; tab close, laptop sleep, and tab discarding kill it; checkpoints would have to live in Drive — the slowest, least transactional place available.
3. **Partial visibility.** The "is bootstrap done" flag other users would check is itself a Drive read subject to the same races — a second user mid-merge can see a partial store.

**The replacement design:**

- **Phase A (in-app, fast):** each staff browser gets a one-click "export my local stores" action — localStorage/IndexedDB serialized into a hashed, counted bundle uploaded to a staging folder. This step is unavoidable in *any* design: a CLI cannot read browser storage, and that data lives only on individual staff machines. All staff run it before migration day; the app then enters an explicit maintenance mode (refuses writes).
- **Phase B (operator-run Node CLI):** inventory → extract → identity resolution → conflict resolution → event synthesis → verify, exactly in your 10-step order, with: refresh-token auth that survives hours; a local **SQLite staging database** whose checkpoint journal commits atomically with the data (per-batch checkpoints inside the long steps, not just per-step — your 10 checkpoints are too coarse for a resume to be cheap); and full logging.
- **Safety comes from idempotent convergence, not the lock:** every synthesized event's ID derives deterministically from its legacy source (file ID + record natural key + transform version), so a re-run or a concurrent accidental second run *converges to the identical event set* instead of double-importing. A Drive lock marker may exist as an advisory tripwire, never as the correctness mechanism — and the Phase 6 "single-flight" test should assert exactly this convergence (see Answer 6).
- **The human is the lock:** one named operator, one run. For a handful of staff this is trivially coordinated.

Two mechanical notes for the backup-first step you mandated (correctly): Drive has no recursive folder-copy — the legacy-folder backup is a per-file copy loop verified against a manifest of server-reported checksums (Drive exposes `sha256Checksum` on binary files, so verification needs no re-download); and Google-native files (Docs/Sheets) expose no content hash and must be exported to a fixed format first, then hashed.

---

## Answer 4 — Can legacy data be merged automatically at all?

**Partially — and the parts that can't must be biased hard toward "don't guess," exactly as your brief already instincts.**

**Identity resolution.** The asymmetry that must drive the whole design: a **false merge** (two real students combined) misattributes payments, attendance and certificates across people, and in an append-only log becomes near-irreversible once new events stack on the merged ID — while a **false split** (one student held as two) costs only a later, audited merge event. Therefore:

- **Tier A — auto-merge:** exact match on a stable legacy ID within one source lineage, or exact match on two independent strong identifiers (e.g. admission number + DOB). Nothing else.
- **Tier B — human adjudication queue:** exact name+DOB, or fuzzy name above threshold *plus* a shared strong signal (phone, guardian contact) — presented with evidence and a suggested disposition.
- **Tier C — keep as separate duplicates**, listed in the import report. This is the *default* disposition, because the system stays operable with duplicates and does not stay correct with false merges.
- **Fuzzy string similarity never auto-merges, at any score.** In a single-school population, edit distance cannot distinguish "same student, typo" from siblings or same-named relatives. Fuzzy matching only *ranks* Tier B suggestions.
- A post-cutover, in-app, fully audited "merge duplicates" flow is what makes the split-biased policy cheap. Every merge decision — human or automatic — is recorded as an event with its evidence.

**Field conflicts.** The precedence rule must be **per-field source ranking**, agreed with you in writing before the dry-run — *not* most-recent-timestamp. Recency is wrong here three times over: legacy timestamps are unreliable (a bulk re-save looks "recent"; localStorage values carry no timestamps at all); the platform's core bug means a freshly re-saved *stale derived balance* would beat a correct older atomic record; and for money, picking either stored number destroys evidence. The invariant at the top of the ranking: **atomic/transactional records always outrank derived aggregates.** Timestamps only break ties within one source.

**Fees specifically.** Legacy *stored balances are not migrated as data at all* — they are migrated as verification fixtures, tagged non-authoritative. The canonical balance is always rebuilt from atomic invoice/payment/adjustment records; the diff between the rebuilt balance and every legacy stored balance is the initial drift report and the seed of the financial adjudication queue. Where atomic financial records from different sources disagree, a human decides — your rule, kept verbatim — and each decision is written as an explicit, attributed adjustment event so the post-migration ledger reconciles *by construction*.

**One gate in 6.3 is ill-posed as written and needs rewording, not weakening:** "financial totals reconcile exactly against legacy" is undefined when the legacy sources contradict each other — which is the project's stated premise. The rigorous version is two-stage: (1) precedence rules + human adjudication produce a single **resolved baseline**, with every delta recorded as an attributed adjustment event and the contradiction list a signed artifact you accept; (2) MegaData's recomputed ledger must equal that baseline **exactly, to the cent, per student and in aggregate** — zero tolerance at stage 2, where exactness is mechanically checkable.

**The human cost, honestly sized:** expect on the order of 100–300 identity adjudications plus a fee-discrepancy list touching a meaningful fraction of active students — several person-days of decision work, not hours. The dry-run reports the tier distribution, so you will see the real queue size *before* committing to the run; treat it as a staffing line item. The queue UI must be built for throughput: ordered by money-at-stake, diff-highlighted, one-keystroke dispositions, pattern batching, resumable across days. And one gate adjustment: "queue is empty" should stay absolute for **financial** conflicts, but for identity items the workable gate is "every item has a recorded disposition (merged / kept-separate / deferred-duplicate)" — otherwise cutover is hostage to a long tail of graduated students for whom kept-separate is safe.

---

## Answer 5 — Is "abandon the old paths once the source of truth exists" safe as a hard cutover?

**No — and your brief already knows it, since 6.3 mandates a shadow period. But the shadow as specified is vacuous and must be redesigned, and the window must be defined in business cycles, not calendar days.**

The defect: 6.3 says during the shadow "the platform writes to MegaData while the legacy paths remain in place *read-only*." If legacy is read-only, no new activity ever reaches it — so the automated comparison can only re-verify the static migrated snapshot and exercises *nothing* on the new write path, which is precisely where new bugs live. "Zero divergence" would be true by construction and prove nothing.

The meaningful version:

- **Scoped dual-write:** the DAL writes MegaData as primary and mirrors legacy-shaped writes for **students and the fee ledger only** — the two entity classes this project exists for. Mirroring all ~20 heterogeneous page formats is throwaway work not worth building.
- **Window:** at least **one full fee cycle** (invoice issuance → payments → arrears follow-up) and ideally one intake boundary, because divergence bugs cluster at cycle events, not uniformly across quiet days. I cannot propose concrete dates without knowing your fee cadence (monthly? termly?) — tell me and I will.
- **Exit criterion:** ≥ 10–14 *consecutive* zero-divergence business days **including at least one cycle event**; any divergence resets the streak after a root-caused fix; three resets triggers a design review, not a fourth silent retry.
- **The comparator** recomputes per-student balances to the cent *from atomic records on both sides* (comparing stored derived balances would reproduce the original disease), reports bidirectional entity-ID set differences (aggregates mask compensating errors), and writes an immutable dated report per run.
- **Platform-specific trap:** the "legacy paths" live in browser profiles on specific staff machines. Snapshot every staff browser's local stores at shadow start, and instrument the app to detect a wiped/reset profile mid-shadow — a cleared profile otherwise silently destroys the comparison baseline.
- Keep legacy read paths behind a feature flag until final sign-off, so rollback is a flag flip, not a redeploy. Retire-by-disconnect-never-delete stands as specified.

---

## Answer 6 — What in this brief is not achievable, and what to do instead

| # | As specified | Why it fails | Replacement |
|---|---|---|---|
| 1 | Drive as *enforcing* primary store (validation gates, append-only, referential integrity) | Drive enforces nothing; every client token can violate every invariant, delete everything, and fragment file ownership | IndexedDB read replica + serialized write broker (Apps Script + LockService, or paid backend) + Drive as broker-owned append-only log/archive |
| 2 | Single-flight login-triggered bootstrap with a lock "living" in Drive | No exclusive create, no CAS, no fencing → every lock protocol races; browser runtime dies on token expiry/tab lifecycle | Operator-run CLI + in-app local-store export step + maintenance mode; safety = deterministic event IDs → idempotent convergence |
| 3 | "Prove it cannot lose a write" (4.2, absolute) | Pre-acknowledgement in-flight actions die with the tab; browser storage is evictable; unconditional proof does not exist in this environment | A stated **acknowledged-write contract**: UI acks only after an atomic IndexedDB outbox commit; persistent outbox → at-least-once upload with backoff; effectively-once via event-ID dedupe; Web Locks single uploader per device; `navigator.storage.persist()`; an always-visible "N unsynced writes" counter; optional synchronous-remote-ack mode for large payments; device-loss-before-upload documented as the residual risk |
| 4 | Per-folder manifests with client-maintained financial **running totals** (5.2) | A shared mutable file under concurrent last-writer-wins update; a maintained total *is* a stored derived balance — banned by the spec's own principles | Manifests are single-writer derived projections (broker or reconciliation job), dated and append-only; totals always computed from event files and compared, mismatch-is-loud kept as specified |
| 5 | "New files **or new revisions**" as append-only history (5.2) | Drive auto-purges unpinned revisions; pinned are capped — history kept as revisions evaporates | New immutable files only; writer-segment JSONL files (not file-per-event — folder caps, listing pain, hours-long migration writes) |
| 6 | Per-page Drive folders persisting each page's derived student/fee records (5.1, 4.1 "both the individual record and the merged result are saved") | Institutionalizes N persistent copies of derived truth — the Phase 0 primary bug class, at Drive scale — and turns reconciliation into permanent policing of self-inflicted drift | Per-page **attestation records** (page ID, projection content hash, log position, timestamp): reconciliation compares hashes and pinpoints the divergent page; any historical view is reproducible from the deterministic projector + log position; a real exports area only for genuine artifacts (PDFs, reports) with provenance; the "merged result" exists only as the regenerable snapshot |
| 7 | `node --check` on every JS file "including JS embedded in HTML" (8) | `node --check` cannot read HTML; inline handlers aren't complete programs | Extraction-based syntax gate: HTML parser extracts every script/handler, parses each with the correct goal (script/module/function-body), reports file+line; the same extracted corpus feeds the DAL-bypass lint |
| 8 | "Assert exactly one import run occurs" (8, single-flight test) | Exactly-once is unprovable without a real mutex; the test would be flaky or vacuous | Assert **convergence**: N concurrent/interrupted bootstrap runs yield a final event set identical to one run, zero duplicate event IDs. (If the broker/CLI is adopted, exactly-once becomes testable against the real mutex and can be kept.) |
| 9 | "Kill the process mid-write … zero records lost" (8) | Not deterministically executable from a browser harness; "zero records lost" is undefined without an acknowledgement point | "Zero **acknowledged-durable** records lost": fault injection between every write-path step, abrupt tab close/crash after ack, offline/reconnect; explicit test of the upload-succeeded-but-ack-lost case via idempotent re-upload |
| 10 | Round-trip "byte-level equivalence of canonical state" (8) | Trivially true for immutable files; spuriously false for rebuilt projections (JSON key order, float formatting, timezones) | Split: (A) segment/snapshot files — SHA-256 equality across the round trip; (B) rebuilt projections — byte equality of a **mandated canonical serialization** (sorted keys, integer minor units, UTC-only timestamps), which also stabilizes every content hash in the design |
| 11 | Cross-page consistency asserted page-vs-page (8) | N² comparisons; a failure doesn't say which page is wrong | Assert every page equals the **canonical projection** (N comparisons, diagnosable failures); add a projection-determinism gate: rebuild all projections twice (Node and browser), assert canonical-serialized equality |
| 12 | "Financial totals reconcile exactly" against legacy sources as found (6.3) | The sources contradict each other — that is the premise; no single figure can equal all of them | Two-stage gate: adjudicated **resolved baseline** first (every delta an attributed adjustment event, contradiction list signed by you), then MegaData ledger = baseline exactly, to the cent, per student and aggregate |

Also achievable-but-needing-additions, flagged now so they are costed: steady-state **disaster recovery** (periodic verified export of the entire MegaData store to a second, independent location; a compromised-token scenario; account-continuity planning for the Google account itself) and **confidentiality** (student PII on shared staff machines, no per-role read authorization in the current design) — neither appears in the brief, and "nothing is ever lost" must also survive deletion, compromise, and account loss, not just crashes.

---

## Decisions and facts I need from you

1. **The constraint fork (biggest decision):** strictly zero-infrastructure on the consumer Gmail account (→ Apps Script broker design, with its stated weaknesses), or are tens of dollars per month acceptable (→ Workspace, or a managed DB/VPS as primary with Drive as mirror — simpler and materially safer for fee data)?
2. **Fee cadence** (monthly / termly / per-course?) — required to propose the shadow-period window and dates.
3. **How the platform is served today** — hosted origin, localhost server, or `file://`? The cross-tab design depends on this.
4. **Scale check:** roughly how many students (active + historical), staff users, and concurrent users? My assumptions: low thousands / ~5–15 / single digits.
5. **Google account ownership and continuity** — whose account is it, and what happens if it is lost?
6. **Confidentiality requirements** — are there institutional/regulatory constraints on where student (possibly minors') PII and fee data may live?
7. **Environment note:** live Drive API access from my build environment may be restricted; per spec 5.3 I will build against a filesystem adapter behind the same interface and will explicitly list everything untested against live Drive in the residual-risk register.

---

## Process disclosure

Per Section 0, the codebase was not read. This verdict was produced from the spec text, the repository's root file listing, and an adversarial review process: three independent assessments (storage/distributed-systems, event-sourcing architecture, migration/reconciliation) followed by a critique pass that corrected several factual errors (Drive item-count caps, `drive.file` scope semantics, Apps Script CORS constraints, over-claimed certainty on empirical rate limits) and surfaced the ownership-fragmentation, disaster-recovery, audit-authenticity and confidentiality gaps folded in above. Claims marked "observed" or "empirical" are not Google-documented guarantees and are flagged for verification in Phase 2/3 design docs.

**Awaiting your verdict on the verdict.** On your sign-off — including your call on the constraint fork — Phase 0 (ground-truth discovery, no code changes) begins.
