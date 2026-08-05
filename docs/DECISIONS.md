# Decisions Register

Running record of client decisions that bind the MegaData work. Source: client
responses to `docs/SECTION-0-VERDICT.md`. Each entry states the decision, its
consequences for the design, and anything still open underneath it.

---

## D1 — Infrastructure: strictly zero-cost, consumer Gmail (2026-08-05)

**Decision:** No paid infrastructure. The platform stays on the free consumer
Google account.

**Consequences (per the amended Section 0 architecture):**
- Read primary = local IndexedDB replica on each device.
- Write serialization/enforcement point = Google Apps Script web app on the
  school's account, using `LockService` as the mutex; it validates, sequences,
  attributes, and owns every file written to Drive (which also prevents
  file-ownership fragmentation across staff accounts).
- Google Drive = durable append-only log + archive, in the three-folder layout
  from the spec, written only by the broker (steady state) and the migration
  CLI (bootstrap).
- Known accepted weaknesses, restated: broker calls are ~1–3 s including cold
  starts; broker auth on a consumer account degrades to an HMAC shared secret
  (the deployment is "anyone with the link"); the broker is a single point of
  failure and clients must queue writes locally while it is unreachable.
- The HMAC secret and any OAuth client configuration must never be committed —
  the repository is public (see D3). Provisioning is runtime/config-side.

## D2 — Fee cadence: per term (2026-08-05, confirmed at the Phase 0 gate)

**Decision:** "Fees can stay per term." Matches the measured model:
per-programme fee totals split into up to 9 term instalments; financial year
April–March, quartered. The shadow-period window will therefore be sized
around a term boundary plus a payment-heavy stretch, proposed concretely in
`docs/04-BOOTSTRAP-AND-CUTOVER.md`.

## D3 — Hosting: GitHub Pages, public repository (2026-08-05)

**Decision:** The platform is and remains hosted on GitHub (Pages) from this
repository.

**Consequences:**
- Single https origin → the cross-tab coordination design (Web Locks leader
  election, BroadcastChannel invalidation, shared IndexedDB) is viable as
  designed. `file://` operation is out of scope for the online copy (the
  Offline System variant has its own served-origin story).
- The repository is **public** (verified via GitHub API and acknowledged by
  the repo's own `.gitignore`): no secrets, tokens, or credentials in the repo
  ever; no real student/staff personal data may be committed — including in
  test fixtures. Phase 0 includes a PII sweep of committed files.
- Deployment = git push; there is no server-side execution on the host, which
  is consistent with D1 (the only server-side component is the Apps Script
  broker, which lives outside the repo).

## D4 — Scale: pending client confirmation (explanation provided)

**Status:** The client asked for the question to be expounded before
answering. Explanation given (see conversation, 2026-08-05). Interim working
numbers from the repo's own 2026-08-03 productivity audit, which profiled with
seeded data at "realistic volumes": ~800 trainees (rosters to 1,200), ~6,000
attendance rows, ~4,000 exam results, ~3,000 chat messages, ~2,000 payments,
single-digit concurrent staff. Phase 0 will measure real record counts from
the legacy stores; the client confirms or corrects.

## D5 — Google account continuity: school-owned, 2FA enabled (2026-08-05)

**Decision:** The Drive account is owned by the school; two-step verification
is enabled and is the client's stated recovery posture.

**Note recorded with the decision:** 2FA protects the account against
takeover; it is not by itself a recovery mechanism. Recommended (not yet
confirmed): printed backup codes stored offline at the Centre, a current
recovery email/phone, and — independent of the account entirely — the periodic
verified export of the full MegaData store to a second location that is
already part of the amended architecture. (The repo's existing `User Login`
design already documents a recovery-email requirement before 2FA can be
enabled, which is consistent with this.)

## D6 — Confidentiality: no additional institutional constraints (2026-08-05)

**Decision:** Client accepts the baseline posture; no institutional or
regulatory constraints were named.

**Baseline that still applies regardless:** no PII in the public repo; DAL
reads scoped by role so pages receive only what their user's role needs;
student/fee data stays in the browser stores and the school's Drive, never in
the repository or any third location; the residual-risk register will carry
the "PII on shared staff machines" exposure explicitly.

## D7 — Phase 0 gate signed off (2026-08-05)

**Decision:** Client confirmed the divergence register in
`docs/00-INVENTORY.md` matches observed behaviour ("Yes"). Phase 1 (domain
research → design principles) proceeds.

## D8 — PII scrub: authorized and executed at HEAD (2026-08-05)

**Decision:** "Carry out PII scrub… once it does not affect data."

**Executed** (commit `43d84f3`): payslip preset employees removed (additive
merge → no-op), cashbook Q3 seed transactions removed (all three seed guards
tolerate an empty array), voucher default signatory blanked, every real
trainee/staff name in tests and code comments replaced with
structure-preserving synthetic names. Verified: both full test suites pass;
zero residual name hits repo-wide; no stored data touched anywhere.

**Explicitly NOT covered, carried as open risk:**
- The removed data remains in **git history** (and any forks/caches). Purging
  requires a coordinated history rewrite (`git filter-repo`/BFG + force-push +
  GitHub support for cached views) — scheduled as a Phase 5 operational task
  with the client, not done unilaterally.
- Published default credentials (`cestisadmin123$`, `Hazardadmin123$`,
  `admin123`, virement PIN `1234`, payroll unlock `123654`) are mechanisms,
  not data; they were left functional. The client should treat them as
  exposed and rotate the real passwords/PIN in the live system.
- The staff TRN/NIS/DOB values that were published should be treated as
  exposed regardless of the scrub.
- The rates.json supply-chain fetch (P8) and committed operational
  identifiers (P7) are Phase 2/5 design items, unchanged.
