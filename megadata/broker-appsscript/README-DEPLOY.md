# Deploying the MegaData broker (Google Apps Script)

**Status: the glue in `Code.gs` is UNTESTED against live Apps Script/Drive** — this build
environment has no Drive access (spec 5.3). The logic it wraps (`broker-core.js`) is fully
covered by the Node suite. Smoke-test after deployment with the steps at the bottom, before any
page or the migration relies on it.

## One-time setup (the school's Google account, ~15 minutes)

1. Open <https://script.new> while signed in as the school account.
2. Name the project `CESTIS MegaData Broker`.
3. In the editor, create ONE script file containing, in this order:
   1. the full contents of `megadata/schemas.js`
   2. the full contents of `megadata/broker-core.js`
   3. the full contents of `megadata/broker-appsscript/Code.gs`
   (Apps Script has no `require`; the modules register themselves on a shared global.)
4. Project Settings → Script Properties → add:
   - `HMAC_SECRET` — a long random string. Generate one locally, e.g.
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
     **Never commit it anywhere** (the repository is public — decision D3). The same value is
     entered once per staff device in the app's broker-settings screen.
   - `MEGADATA_FOLDER_ID` = `1-BVqRHL3bh0UB30pvlXt0AWAsKWsueec` (the MegaData master folder from
     the spec — the broker will create its files alongside the existing
     `cestis-master-snapshot.json`, which it never touches).
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

Then run one signed `append` with a test event and confirm: `seg-000000-1-1.jsonl`,
`head.json`, and `broker-state.json` appear in the MegaData folder, and a replay of the same
body returns the identical ack without creating a second segment.

## Known limits (by design — docs/02 §9, §15)

- ~1–3 s per call including cold starts; clients batch and poll at ≥20 s.
- `LockService` serializes appends; 25 s lock wait then `{"error":"busy","retryable":true}`
  (clients back off and retry — the broker client already does).
- If the broker is down, pages keep working offline-first; the outbox drains on recovery.
- The promise-draining loop in `Code.gs` (`Utilities.sleep` polling) is the part most likely to
  need adjustment against the live V8 runtime — verify with the smoke test; if it stalls,
  replace the async `sha256Hex` path in `schemas.js` with `Utilities.computeDigest` when running
  inside Apps Script (a 5-line change flagged in code).
