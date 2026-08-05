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

## D2 — Fee cadence: pending client answer (explanation provided)

**Status:** The client asked what this means before answering. Explanation
given (see conversation, 2026-08-05); Phase 0 will also measure the cadence
empirically from fee data so a concrete shadow-period window can be proposed
for confirmation rather than asked for cold.

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
