# Deploying the MegaData broker (Google Apps Script)

**Status: the glue in `Code.gs` is UNTESTED against live Apps Script/Drive** — this build
environment has no Drive access (spec 5.3). The logic it wraps (`broker-core.js`) is fully
covered by the Node suite. Smoke-test after deployment with the steps at the bottom, before any
page or the migration relies on it.

## One-time setup (the school's Google account, ~15 minutes)

**Everything you paste is ONE file:** `megadata/broker-appsscript/PASTE-ALL-IN-ONE.gs`
(generated from the three sources by `build-paste.js`; a drift test keeps it in sync — never
edit the pasted copy by hand, rebuild instead).

1. Open <https://script.new> while signed in as the school account.
2. Name the project `CESTIS MegaData Broker` (click "Untitled project", top-left).
3. The editor shows a file with a stub `function myFunction() {}`. Select ALL of it, delete
   it, and paste the entire contents of `PASTE-ALL-IN-ONE.gs` in its place. Save (Ctrl+S).
4. Click the ⚙️ gear ("Project Settings") in the left sidebar → scroll down to
   **Script Properties** → "Add script property", twice:
   - `HMAC_SECRET` — a long random string. Easiest: open `MegaData-Admin.html` on any school
     computer and press **"Make me a strong secret"** (card 2); copy the value it shows and
     keep an offline copy somewhere safe. **Never commit it anywhere** (the repository is
     public — decision D3). The same value is entered once per staff device in the same card.
   - `MEGADATA_FOLDER_ID` = `1-BVqRHL3bh0UB30pvlXt0AWAsKWsueec` (the MegaData master folder from
     the spec — the broker will create its files alongside the existing
     `cestis-master-snapshot.json`, which it never touches).
   Press "Save script properties".
5. Deploy → New deployment → type **Web app**:
   - Execute as: **Me** (the school account)
   - Who has access: **Anyone with the link** (consumer-account constraint; the HMAC is the
     auth layer — accepted weakness per decision D1)
6. Authorize the Drive scope when prompted. Copy the deployment URL (`…/exec`).
7. The URL + secret are what each device asks for: open **`MegaData-Admin.html`** on every
   school computer, paste both into card 2 ("Broker connection"), press **Test connection**,
   then **Save on this device**. They are stored in that browser's local meta store only —
   never in the repo, never in an export bundle. Until the migration is sealed, saving
   changes nothing about how the pages behave.

## Smoke test (run before anything depends on it)

```bash
# 1. Health:
curl -sL '<DEPLOY_URL>'          # → {"ok":true,"service":"cestis-megadata-broker",...}

# 2. Signed head query (replace SECRET and URL):
node -e '
const MD=require("./megadata/schemas.js");
MD.sha256Hex(process.env.S+"|"+MD.canon({})).then(h=>
  console.log(JSON.stringify({op:"headq",auth:h,payload:{}})))' S='<SECRET>' \
| curl -sL -X POST -H 'Content-Type: text/plain;charset=utf-8' -d @- '<DEPLOY_URL>'
#   → {"seq":0,"chain":"genesis"}

# 3. Wrong secret must fail:  … → {"error":"auth failed"}
```

The first real `append` exercise is the migration upload itself
(`node megadata/bootstrap-upload.js --url <…/exec>` after a `--commit` run): it uploads in
batches, pulls everything back, checks the id set and recomputes the hash chain against the
broker's head, and only `--seal`s when verification passes. Re-running it is always safe —
replayed events are answered with their original acks. After it, confirm `seg-…jsonl`,
`head.json` and `broker-state.json` appeared in the MegaData folder.

## Updating an already-deployed broker (keeps the same URL + secret)

1. Open the project at <https://script.google.com> → *CESTIS MegaData Broker*.
2. Select all the code, delete it, paste the NEW `PASTE-ALL-IN-ONE.gs`, save.
3. **Deploy → Manage deployments → ✏️ Edit → Version: "New version" → Deploy.**
   The `/exec` URL stays the same, every device keeps working, nothing re-enters.
   (Deploy → *New deployment* would mint a DIFFERENT URL — don't, unless rotating on purpose.)

## Fetching the legacy backups through the broker (no manual downloads)

The broker runs inside the school's account, so the migration can pull its own sources:

```bash
node megadata/bootstrap-cli.js --from-drive --url '<DEPLOY_URL>'          # dry run
node megadata/bootstrap-cli.js --from-drive --url '<DEPLOY_URL>' --commit # the real run, after review
```

`listLegacy` searches the WHOLE Drive by the exact backup filenames (no folder ids needed);
where the same backup exists in several folders the NEWEST copy is used and every duplicate is
reported. Fetched files are written verbatim into `--src` (default `./megadata-sources`), so
the run's inventory hashes exactly what was reviewed. Device export bundles (card 3 of
MegaData-Admin) are still added to that folder by hand — they are downloads, not Drive files.

## Known limits (by design — docs/02 §9, §15)

- ~1–3 s per call including cold starts; clients batch and poll at ≥20 s.
- `LockService` serializes appends; 25 s lock wait then `{"error":"busy","retryable":true}`
  (clients back off and retry — the broker client already does).
- If the broker is down, pages keep working offline-first; the outbox drains on recovery.
- `sha256Hex` now carries a native Apps Script branch (`Utilities.computeDigest`) baked into
  the paste file, so every promise in the broker resolves synchronously — no post-paste edits.
  The `Utilities.sleep` draining loop in `Code.gs` remains the belt-and-braces backstop and the
  first thing to look at if the smoke test ever stalls.
