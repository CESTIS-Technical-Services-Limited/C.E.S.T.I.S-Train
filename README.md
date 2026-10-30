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
- **Loaded only where a broker is set up.** No broker is deployed, so MegaData is dormant: the
  everyday pages load only `megadata/loader.js` (about 1.5 KB on the wire), which fetches the
  page's MegaData scripts (listed in its tag) only on a device whose browser holds broker
  settings from `MegaData-Admin.html`. The two MegaData admin pages load everything as before.
  The operator checklist below is how MegaData would be switched on; it is not part of running
  the Centre.

**October 2026 upgrade:** what changed across the whole platform, what the Centre must do before
deploying, what is still open, and the UI and feature roadmap are in
[`docs/UPGRADE-2026-10.md`](docs/UPGRADE-2026-10.md).

## Running the tests

```
npm test                       # every Node suite, both builds; ends by printing how many suites and checks passed
npm run test:syntax            # node --check over every standalone JS file
npm run build:offline          # stamp the ?v= tags (npm run stamp), then regenerate "Offline System/" (a test fails on drift)
npm run test:browser           # real Chromium over the real pages (zero uncaught errors)
npm run test:browser:flows     # a whole training day, live class to certificate, through the real screens
npm run test:browser:upgrade   # a Centre's data written by the previous version, opened by this one
#   ...and test:browser:offline / :auth / :cert / :vc / :ui / :security / :transcripts / :fee
node megadata/bootstrap-cli.js --src tests/fixtures    # migration dry-run over the real (anonymised) backup
```

The browser suites need Playwright's Chromium (`NODE_PATH` pointing at `playwright-core`). The
counts are not kept here: `npm test` prints them (it runs `tools/run-tests.js`, which keeps going
past a failure and names every suite that failed). GitHub runs `npm test`, the syntax, wording,
Offline System and version-tag checks and three quick browser suites on every pull request and
every change to `main` (`.github/workflows/checks.yml`).

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

## The offline copy (service worker) and its kill switch

`sw.js` lets the dashboard open with no connection (and be installed from `manifest.json`).
It is **network-first**: whenever the network answers, that answer is used, so a deploy is
never hidden behind an old copy; the copy is used only when a request fails. It never touches
other sites (Google, Drive, EmailJS, PeerJS, CDNs), the Offline System's `/_cestis/` and
`/peerjs` calls, or anything but GET. Its rules are pinned by `tests/service-worker.test.js`.

To switch it off everywhere, deploy a file named **`sw-disable`** (any content) next to
`index.html`: on the next page load each browser unregisters the worker and deletes its copy.
Delete the file to allow it again. On a single device, open the site with `?sw=off`.
Changing `sw.js` at all makes every browser pick up the new worker on its next visit; bump
`CACHE_VERSION` in it to drop every stored copy.

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
| `cestis-config.js` | **the Centre's own account ids** — Drive folders, the Google sign-in client, EmailJS. The one file to edit after a lost or changed account: see "Changing the Centre's account" in `docs/UPGRADE-2026-10.md` |
| `megadata/schemas.js` | canonical serialization, ids, the event REGISTRY |
| `megadata/broker-core.js` | broker validation core (also runs inside Apps Script) |
| `megadata/projections.js` | folds: entities, ledgers, quarters, roster, adjudications |
| `megadata/dal.js` | the data-access layer every page uses |
| `megadata/bootstrap-core.js` + `bootstrap-cli.js` | the one-time migration |
| `megadata/pages/` | per-page bridge models + glue |
| `MegaData-Admin.html` / `MegaData-Adjudication.html` | operator pages |
| `docs/` | the signed project record |
| `docs/05-RESIDUAL-RISKS.md` | what can still go wrong, honestly |
