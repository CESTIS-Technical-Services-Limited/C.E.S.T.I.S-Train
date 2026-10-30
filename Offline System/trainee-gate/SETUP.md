# Trainee sign-in from anywhere — setup sheet

This sheet is for the Centre's administrator. It sets up the small program that lets each
trainee sign in from their own phone, or any lab PC, and see **only their own records** — and lets
a new trainee **register from home** with their own Google account, for the office to approve
(section 7). It runs inside the Centre's own Google account, costs nothing, and takes about
10 minutes once.

**Until you finish step 9 and press *Turn on*, nothing changes for anybody.** You can stop at any
step and come back later.

What you need:

- the office PC, with the dashboard open and you signed in as an **administrator**;
- the **Centre's Google account** (the one that holds the Centre's records), signed in **in the
  same browser**.

> For whoever installs it: the program is `trainee-gate/PASTE-GATE.gs`. It is built from
> `cestis-core.js` and `trainee-gate/Gate.gs` by `npm run build:gate` — never edit the paste by
> hand. Its first line says `mode: allowlist` (only the shared rules the gate runs, ~360 KB) or
> `mode: full` (all of `cestis-core.js`, ~0.9 MB).

---

## 1. One-time setup (about 10 minutes)

1. **Copy the program.** In the dashboard: **Settings → Trainee sign-in from anywhere → Copy the
   setup code**.
   - *If that button is not there yet:* open the repository on GitHub, click
     `trainee-gate` → `PASTE-GATE.gs`, then the **Copy raw file** button (two overlapping squares,
     top right of the file). Or open `https://<the dashboard's address>/trainee-gate/PASTE-GATE.gs`;
     if the browser downloads it instead of showing it, open the downloaded file in Notepad and press
     **Ctrl+A**, **Ctrl+C**.
2. In the same browser, signed in to the **Centre's Google account**, open
   **https://script.new**. A new, empty project opens.
3. Click **Untitled project** (top left), type `CESTIS Trainee Gate`, click **Rename**.
4. Click inside the code. Press **Ctrl+A**, then **Delete**, then **Ctrl+V**, then **Ctrl+S**.
   Wait until the file name stops showing a dot or "Saving…". *(This is live check 1 below — if the
   editor refuses the paste, see there.)*
5. Click **Deploy** (top right) → **New deployment** → the **gear** next to *Select type* →
   **Web app**.
   - *Description:* `Trainee gate`
   - *Execute as:* **Me** (the Centre's account)
   - *Who has access:* **Anyone**  ← not "Anyone with Google account"
   - Click **Deploy**.
6. Click **Authorize access** → choose the **Centre's account** → **Advanced** → **Go to CESTIS
   Trainee Gate (unsafe)** → **Allow**. This warning is normal for an account's own program. It asks
   for three things:
   - *See, edit, create and delete all of your Google Drive files* — to read the published records
     and keep what trainees send in their own folders;
   - *Connect to an external service* — to check an email sign-in with Google;
   - *Send email as you* — for emailed sign-in codes (at most 100 a day; backup codes always work).
7. Copy the **Web app URL** (it ends in `/exec`) and click **Done**.
8. Back in the dashboard card, paste it into **Address** and press **Check**. The first check makes
   the program create its folders, its secret and `CESTIS_GATE.json`. Expect **"Ready — version 2"**
   and the number of trainee accounts.
   - *If the card is not there yet:* paste the address into a new browser tab and add `?op=selfcheck`
     to the end. You should see a page of ✓ lines: *Secret made*, *Folders present*, *Accounts list
     found (N trainee accounts …)*.
   - "Accounts list not found yet" means no staff member has signed in on the dashboard since the
     accounts list was introduced. Sign in on the dashboard once, wait a minute, check again.
9. Press **Turn on**. Print the trainees' QR code, or show it on the lab screens.

Nobody types a secret. The program makes its own the first time it runs and keeps it in its Script
Properties.

Now run the **live checks** (section 3) once.

---

## 2. Upgrading to a new version (the address stays the same)

> **Version 2 (October 2026) must be pasted again.** It adds registration from home (section 7)
> and names each trainee's folder with their name and student ID. Until it is pasted, the
> dashboard card says *"A newer version is available"*, trainees can still sign in as before, and
> the "Register with your email account" button answers *"Registration is not open just now"*.
> Follow the five steps below; the address does not change.

1. Copy the program again (step 1 above).
2. Open **https://script.google.com** (signed in as the Centre) → click **CESTIS Trainee Gate**.
3. Click in the code → **Ctrl+A** → **Ctrl+V** → **Ctrl+S**.
4. **Deploy → Manage deployments → ✏ (Edit) → Version: New version → Deploy.**
5. Open the address with `?op=selfcheck` — the first line shows the new version.

Never use **Deploy → New deployment** for an upgrade: that makes a **new address**, and every
trainee's link and QR code would have to be shared again. (The old address keeps working until it is
archived.)

---

## 3. Live checks — run once, after setup

These check the things that cannot be tested before the program runs in the Centre's own account.
Each says what to do and what to do if it fails. Nothing here touches anybody's records. Write the
results down and send them to whoever maintains the dashboard.

*"The address"* below means the Web app URL from step 7. For the checks in the browser console:
open the dashboard's own site in Chrome, press **F12**, click **Console**, paste the line, press
**Enter**. Put the address between the quotes at the start.

### Live check 1 — the program is accepted, and how long a cold start takes

- **Do:** after step 4, the editor must save without a red message. Then, in the editor's toolbar,
  choose the function **`gateSetupNow`** in the list next to *Debug*, click **Run**, and allow access
  if asked. The *Execution log* shows `"ok": true` and `"ready"`.
  Then open the address with `?op=health` in a new private window, wait an hour, and open it again.
  In the editor's left bar, **Executions** (⏱) lists each request with its duration.
- **Expect:** saves fine; the first request of the hour ("cold") under **5 seconds**; later ones
  under **1.5 seconds**.
- **If the editor refuses or freezes on the paste:** split it into two script files. Make a second
  file with **+ → Script**, name it `Gate`. Move everything from the line
  `/* ======== trainee-gate/Gate.gs` to the end into that file. Save both. The program is the same;
  it just arrives in two parts (their order in the list does not matter).
- **If a cold start takes over 10 seconds:** note the time. The dashboard waits up to 30 seconds,
  so it still works. Tell the maintainer.
- **If the Executions log ever shows "… is not in the gate's paste":** the maintainer rebuilds with
  `node trainee-gate/build-paste.js --full` (the whole rules file, ~0.9 MB) and you upgrade (section 2).

### Live check 2 — the dashboard's site may call the program (CORS, plain-text POST)

- **Do (console):**
  ```js
  var GATE = 'https://script.google.com/macros/s/…/exec';
  fetch(GATE, { method: 'POST', body: JSON.stringify({ op: 'health' }) })
    .then(r => r.json()).then(j => console.log('OK', j)).catch(e => console.log('FAILED', e));
  ```
- **Expect:** `OK {ok: true, service: "cestis-trainee-gate", version: 2, …}`. (A text body is sent
  as `text/plain`, so the browser asks no permission first.)
- **If FAILED with "CORS" or "blocked":** check that step 5 said **Who has access: Anyone**, and
  that the address ends in `/exec` (not `/dev`). Fix with **Deploy → Manage deployments → ✏ → Who
  has access: Anyone → Deploy**, then try again. If it still fails, stop here and tell the maintainer —
  until this works the program cannot be used, and nothing changes for anybody.

### Live check 3 — a 7 MB request arrives whole (a 5 MB upload is about 6.7 MB on the way)

- **Do (console, after check 2):**
  ```js
  var body = JSON.stringify({ op: 'diag.echo', pad: 'x'.repeat(7 * 1024 * 1024) });
  fetch(GATE, { method: 'POST', body }).then(r => r.json())
    .then(j => console.log(j.chars === body.length ? 'OK: 7 MB arrived whole' : 'FAILED', j))
    .catch(e => console.log('FAILED', e));
  ```
- **Expect:** `OK: 7 MB arrived whole`.
- **If FAILED:** try `4 * 1024 * 1024`, then `2 * 1024 * 1024`, and note the largest that passes.
  The maintainer then lowers the upload limit to fit (or sends files in parts). Until then, ask
  trainees to keep files small.

### Live check 4 — Google's token check names the dashboard (`aud`)

- **Do (console, on the dashboard's sign-in page):**
  ```js
  google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_DRIVE_CONFIG.CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    callback: function (t) {
      fetch(GATE, { method: 'POST', body: JSON.stringify({ op: 'diag.tokeninfo', accessToken: t.access_token }) })
        .then(r => r.json()).then(j => console.log(j));
    } }).requestAccessToken();
  ```
  Choose any email account (yours is fine). Only field names and yes/no answers come back — never the
  address.
- **Expect:** `audIsOurs: true`, `emailVerified: true`, `hasEmailScope: true`, and `fields` listing
  `aud`.
- **If `audIsOurs` is false:** the program checks against the dashboard's own sign-in client. If the
  site uses another one, add it in the editor: **Project Settings (⚙) → Script properties → Add
  script property** → `GOOGLE_CLIENT_ID` = the client id → **Save**. If `aud` is not in `fields` at
  all, tell the maintainer (email sign-in and registration from home through this program stay
  off; password sign-in works).

### Live check 5 — a file is found by the start of its name

- **Do:** open the address with `?op=selfcheck` and find the *Name search* line. Then, on the
  **office PC** where the dashboard is signed in and synced, in the console:
  ```js
  fetch('https://www.googleapis.com/drive/v3/files?fields=files(id,name)&q=' +
    encodeURIComponent("name contains 'CESTISSMOKE' and trashed = false"),
    { headers: { Authorization: 'Bearer ' + googleAccessToken } }).then(r => r.json()).then(j => console.log(j));
  ```
- **Expect:** *✓ Name search finds a file by the start of its name*, and the console lists one file,
  `CESTISSMOKE.name-check.json`. (A new file can take a few minutes to be found; look again.)
- **If either fails after 30 minutes:** tell the maintainer. The office PCs will then look in each
  trainee's folder instead of searching (slower, but it works).

### Live check 6 — writing once a second for five minutes is not refused

- **Do:** in the editor, choose the function **`gateSmokeWriteRate`** → **Run**, and wait about five
  minutes until the log shows `{"writes":300,"errors":0,…}`. It writes only to its own test file.
- **Expect:** `errors: 0`; the check page then shows *✓ Write-rate check … 300 writes, 0 refused*.
- **If errors is above 0:** note `firstError`. The maintainer then makes the program and the office
  PCs write more slowly (for example, exam answers saved every two minutes instead of every minute).

### Live check 7 — a folder is found by the words in its description

- **Do:** open the address with `?op=selfcheck` and find the *Description search* line.
- **Expect:** *✓ Description search finds a folder by its description*. Just after setup it may say
  "not found yet (made N min ago)" — look again after 10 minutes.
- **If it still says ✗ after 30 minutes:** the program still finds a folder it made itself, or one
  it found once before (it remembers them), and a folder still named with the student ID alone.
  Tell the maintainer; a trainee whose folder was renamed to "Name (student ID)" before the
  program first looked for it may wait a little longer for their records.

---

## 4. Turning it off

Any of these returns trainee sign-in to how it works today. What trainees' devices have not sent
yet stays on their devices and is sent when the program is back.

- In the dashboard card: **Turn off**.
- In the editor: **Project Settings (⚙) → Script properties → Add script property** → `GATE_OFF`
  = `1` → **Save**. Takes effect within a minute. Delete the property to turn it back on.
- A file named `gate-off` (any content) in the **CESTIS Trainee Gate** folder in the Centre's
  Drive. Takes effect within a minute; move it to the bin to turn back on.
- **Deploy → Manage deployments → Archive.** This stops the address for good; turning back on
  needs a *New deployment*, which is a new address (re-share the QR code).

## 5. Please never

- **Delete or change `GK_SECRET`** in Script properties. Everyone would have to sign in again, and
  work waiting on their devices would have to be sealed again at their next sign-in (nothing is lost,
  but it is a nuisance).
- **Move, rename or bin the *CESTIS Trainee Gate* folder or the folders inside it.** The program
  never makes them again (that would leave the trainees' work behind). If one went to the bin,
  restore it; the check page says "A folder is missing".
- **Delete anything in a trainee's folder.** The files starting `CESTISINBOX` are what that trainee
  sent; the office PCs collect them.
- **Share the project or the editor** with anyone. The address alone is safe to share — that is
  what the QR code is.

## 6. What it keeps, and where

In the Centre's Drive, made by the program on its first check:

```
CESTIS Trainee Gate/
  _gate/            its own notes and the live-check test files
  Exam keys/        answer keys — read for marking, never handed out
  Papers/           test papers — handed out only while a test is open
  Rooms/            chat rooms' history — to their members only
  Trainees/         one folder per trainee account, named "Name (student ID)",
                    e.g. "Tameka Richards (STU-3wfiayryzq)"
  Registrations/    registrations sent from home (CESTISREG.<account>.json), and
                    catalogue.json — the programmes taking trainees (the office PCs write it)
CESTIS_GATE.json    beside the accounts list, so the office PCs find the folders
```

Script properties made by the program: `GK_SECRET`, `GATE_ROOT_ID`, `GATE_FOLDER_ID`, `TRAINEES_ID`,
`KEYS_ID`, `PAPERS_ID`, `ROOMS_ID`, `REGISTRATIONS_ID`, `LEDGER_FOUND_ID`, `LEDGER_NOTE`,
`GATE_SETUP_VERSION`, and many `fold:…`, `spent:…` and `out:…` entries. Leave them alone.

Script properties you may add: `GATE_OFF` (above), `GOOGLE_CLIENT_ID` (live check 4),
`LEDGER_FILE_ID` (the id of the accounts list to use, if the check page says it found several and
chose the wrong one), `MIN_CLIENT` (only if the maintainer asks).

The *Executions* page (⏱ in the editor's left bar) is its only log. It shows errors, never names.

A trainee's folder is **found by the account written in its description** (`cestis-trainee
acct=USR-… v=1`), never by its name, so renaming a trainee never loses their folder: the office PCs
rename the folder to match. A folder made by a registration from home says
`registration=pending` at the end of its description while it waits, and `registration=rejected`
if the office turns it down. **No folder is ever deleted or put in the bin** — not by the program,
not by the office PCs.

---

## 7. Registration from home, and accounts made in the office

**The office makes an account** (Administrators, and Admin Staff unless an Administrator unticks
*Trainee Accounts* in **Settings → Admin Staff Access**): *Verify Users* (Admin Staff: *Trainee
Accounts*) → **+ Add Trainee Account**. The account works at once. With trainee sign-in from
anywhere turned on, the trainee's folder appears within seconds; with it off, it is made the first
time it is turned on. Admin Staff can make **trainee accounts only**.

**A trainee registers from home** (the program must be version 2):

1. On their phone, from the trainees' link or QR code: **New trainee? Register with your email
   account**. Google's own sign-in window opens; they choose their Google account. Only a Google
   account whose address Google has confirmed is accepted — there is no other way to register from
   home.
2. The form asks for their full name (first and last), their programme (those taking trainees now),
   a phone number (optional) and a password. They press **Register**.
3. At that moment the program keeps the registration in `Registrations/` **and** makes their folder
   in `Trainees/`, named "Name (student ID)". The phone says *"Your registration has reached the
   office."* Registering again with the same Google account finds the same registration — never a
   second one, never a second folder.
4. Within a minute, the office PCs bring it into **Verify Users** (Admin Staff: *Trainee Accounts*),
   marked *"Registered from home · email account verified"*. **Activate** approves it (the trainee's
   record is made and their records go into the folder made in step 3); **Reject** turns it down
   (the folder is kept and marked).
5. Once approved, the trainee signs in at home with their Google account **or** with the password
   they chose in step 2.

On the Centre's own network (the Offline System) registering from home is not available: the office
creates the account there.

Limits, so nobody can fill the Centre's Drive: five tries an hour for one address; 60
registrations an hour and 200 in six hours for everybody.
