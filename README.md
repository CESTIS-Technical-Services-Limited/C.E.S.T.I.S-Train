# CESTIS Training LMS + MegaData

The Centre's static-page LMS (GitHub Pages, consumer-Gmail Drive — decision D1: strictly
zero-cost infrastructure) plus **MegaData**, the single canonical append-only data layer that
replaces per-page storage silos. Full background: `MEGADATA_SPEC.md` (the client brief),
`docs/SECTION-0-VERDICT.md` (the signed feasibility verdict), `docs/DECISIONS.md` (D1–D11),
`docs/02-MEGADATA-ARCHITECTURE.md` (the design), `docs/04-BOOTSTRAP-AND-CUTOVER.md` (the
migration), `docs/03-VERIFICATION.md` (gate-by-gate proof with actual outputs).

## How it fits together

- **Events, not edits.** Every business action (a payment, an enrolment, a grade, a cashbook
  entry) is an immutable event. Balances and lists are *folds* over the log — never stored
  numbers. Corrections supersede; nothing is edited in place. Fees and the cashbook are
  **separate books** (D11).
- **The broker** (`megadata/broker-appsscript/` — a Google Apps Script web app in the school's
  own account) is the single serialized writer: it validates every batch, assigns the global
  sequence and human-facing numbers (receipts R-, certs CT-, invoices INV-, …; preserved legacy
  numbers are never reassigned), maintains the hash chain, and appends to Drive.
- **Every browser holds a replica** (IndexedDB `CESTIS_MEGA`): writes commit locally in one
  atomic transaction (event + outbox + counter), upload at-least-once with idempotent replay,
  and every id is deterministic — so crashes, retries, and device races **converge** instead of
  duplicating (principle P10).
- **The legacy pages are untouched.** Each page gets a small bridge (`megadata/pages/*-page.js`)
  that wraps its own save function(s): in *shadow* mode local writes flow into the record book
  and remote changes mirror back into legacy storage; in *legacy* mode (no broker configured,
  or migration not sealed) pages behave byte-identically to today.

## Running the tests

```
npm test                # 48 Node suites — schemas, broker, DAL, bootstrap, every page bridge
npm run test:browser    # real Chromium over 14 real pages (zero uncaught errors)
npm run test:syntax     # node --check over every standalone JS file
node megadata/bootstrap-cli.js --src tests/fixtures    # migration dry-run over the real (anonymised) backup
```

## Setting the system up (operator checklist)

1. **Deploy the broker** — follow `megadata/broker-appsscript/README-DEPLOY.md` in the school's
   Google account: paste `Code.gs`, set Script Properties `HMAC_SECRET` (a long random string —
   this is the shared secret) and the MegaData folder id, deploy as a web app, run the README's
   smoke tests. *The secret lives in Script Properties and on each device only. It must never
   be committed — this repository is public.*
2. **Provision each device** — open `MegaData-Admin.html` on every school computer: paste the
   broker URL + secret into card 2, *Test connection*, *Save on this device*. Card 3 (*Export
   local data*) downloads that machine's browser-local stores as
   `master-snapshot.<device>.<date>.json` — run it on **every** machine and collect the files.
3. **Run the migration** — one named operator, one machine (docs/04): put the downloaded Drive
   JSON files + every device export into a folder, run the CLI **without** `--commit` first,
   review the printed plan (counts, financial identities, adjudication queue size), then run
   with `--commit` and seal via the broker gate.
4. **Work the queue** — `MegaData-Adjudication.html` lists every identity question the
   migration refused to guess at, ordered by money at stake; decisions are one keystroke and
   sync everywhere. Cutover requires every item to carry a disposition.
5. **Shadow, then cutover** — pages run in shadow (legacy UI, canonical data flow, per-page
   comparators such as `window.__feeReconcile()` / `__cbReconcile()`) until the exit criteria
   in docs/04 §8 are met; the cutover checklist is docs/04 §9.

## Adding a page to MegaData

1. Pick the pattern: **Tier-A** for money/events (see `pages/fee-model.js`,
   `pages/cashbook-model.js`, `pages/findoc-model.js`) or **docsync** for keyed document
   collections (`pages/docsync-model.js` + a small spec table, see `pages/tg-model.js`,
   `pages/ps-model.js`, `pages/lms-model.js`).
2. Derivations must be **byte-identical to the bootstrap's** (`bootstrapId`, the extractor's
   key formats) — and pinned by a drift-guard test, like every existing suite does.
3. Write the glue (`pages/<x>-page.js`): `pageBoot` → wrap the page's own save chokepoint →
   serialized tick (plan → push → sync → mirror-apply) → the page's own loader + renderers.
   The legacy page's inline code is never edited; only `<script src>` includes are added.
4. Add a Node suite (drift guard, push/apply/no-ping-pong, race dedupe) + a browser smoke
   section, and wire both into `package.json`.

## Where things live

| Path | What |
|---|---|
| `megadata/schemas.js` | canonical serialization, ids, the event REGISTRY |
| `megadata/broker-core.js` | broker validation core (also runs inside Apps Script) |
| `megadata/projections.js` | folds: entities, ledgers, quarters, roster, adjudications |
| `megadata/dal.js` | the data-access layer every page uses |
| `megadata/bootstrap-core.js` + `bootstrap-cli.js` | the one-time migration |
| `megadata/pages/` | per-page bridge models + glue |
| `MegaData-Admin.html` / `MegaData-Adjudication.html` | operator pages |
| `docs/` | the signed project record |
| `docs/05-RESIDUAL-RISKS.md` | what can still go wrong, honestly |
