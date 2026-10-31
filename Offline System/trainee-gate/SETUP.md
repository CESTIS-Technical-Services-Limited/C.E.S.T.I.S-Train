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
   - *Send email as you* — for emailed sign-in codes, and to tell a trainee who registered from home
     that the office has approved her (at most 100 emails a day in all; backup codes always work).
7. Copy the **Web app URL** (it ends in `/exec`) and click **Done**.
8. Back in the dashboard card, paste it into **Address** and press **Check**. The first check makes
   the program create its folders, its secret and `CESTIS_GATE.json`. Expect **"Ready — version 4"**
   and the number of trainee accounts.
   - The card's **Open the full check page** button (under *Checks after setup*) opens a page of ✓
     lines: *Secret made*, *Folders present*, *Accounts list found (N trainee accounts …)*.
   - "Accounts list not found yet" means no staff member has signed in on the dashboard since the
     accounts list was introduced. Sign in on the dashboard once, wait a minute, check again.
9. Press **Turn on**. Print the trainees' QR code, or show it on the lab screens.

Nobody types a secret. The program makes its own the first time it runs and keeps it in its Script
Properties.

Now run the **live checks** (section 3) once.

---

## 2. Upgrading to a new version (the address stays the same)

> **Version 4 (November 2026) is the version to set up.** If the program has never been set up,
> just follow section 1: nothing needs pasting twice. Version 4 adds the **prepared assessments**
> for trainees at home (section 8): **extra time** the office adds reaches her clock while she sits
> a test, her **signature** goes with her submission, and a **group practical**'s photos, hand-in and
> each member's signature. Version 3 added their fees and receipts, changing their own password,
> downloading their certificate, photos and files sent in parts, and an email when the office
> approves a registration from home (section 7). Version 2 added registration from home and names
> each trainee's folder with their name and student ID.
>
> If an older version is running, the dashboard card says *"A newer version is available"* and
> trainees can still sign in as before; until it is pasted, extra time reaches a trainee at home only
> when her records are next sent to her, and a group practical's photos and sign-offs cannot be sent
> from home (her phone keeps them until the new version is pasted). Follow the five steps below; the
> address does not change.

1. Copy the program again (step 1 above).
2. Open **https://script.google.com** (signed in as the Centre) → click **CESTIS Trainee Gate**.
3. Click in the code → **Ctrl+A** → **Ctrl+V** → **Ctrl+S**.
4. **Deploy → Manage deployments → ✏ (Edit) → Version: New version → Deploy.**
5. Press **Open the full check page** on the dashboard card — the first line shows the new version.

Never use **Deploy → New deployment** for an upgrade: that makes a **new address**, and every
trainee's link and QR code would have to be shared again. (The old address keeps working until it is
archived.)

---

## 3. Live checks — run once, after setup

These check the things that cannot be tested before the program runs in the Centre's own account.
Each says what to do and what to do if it fails. Nothing here touches anybody's records. Write the
results down and send them to whoever maintains the dashboard.

**No code to paste.** Checks 2, 3, 4 and 5 are buttons on the dashboard card: **Settings → Trainee
Sign-in from Anywhere → Checks after setup**. Press each one once, on the office PC, signed in as an
administrator with sync turned on. Each button writes its answer under the buttons, starting with
✓ (good), ✗ (needs fixing, with what to do) or • (look again shortly). The card uses the address you
pasted in step 8. Checks 1, 6 and 7 are done in the program's editor and on its check page, as
below.

*"The address"* below means the Web app URL from step 7.

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

- **Do:** press **This page can reach it**.
- **Expect:** *✓ Live check 2: this page can reach trainee sign-in — version 4.* (Behind it, the
  program answers `{ok: true, service: "cestis-trainee-gate", version: 4, …}`. The button sends a
  text body, `text/plain`, so the browser asks no permission first.)
- **If it says ✗:** check that step 5 said **Who has access: Anyone**, and
  that the address ends in `/exec` (not `/dev`). Fix with **Deploy → Manage deployments → ✏ → Who
  has access: Anyone → Deploy**, then try again. If it still fails, stop here and tell the maintainer —
  until this works the program cannot be used, and nothing changes for anybody.

### Live check 3 — a 7 MB request arrives whole (a 5 MB upload is about 6.7 MB on the way)

- **Do (after check 2):** press **A large file arrives whole**. It takes up to a minute.
- **Expect:** *✓ Live check 3: a 7 MB request arrived whole, so a 5 MB file can be sent.*
- **If it says the largest that arrived whole was 4 MB or 2 MB (amber), or ✗:** the button has
  already tried the smaller sizes for you; note what it says. The maintainer then lowers the upload
  limit to fit (or sends files in parts). Until then, ask trainees to keep files small. *"Too many
  checks in a minute"* means wait a minute and press again.

### Live check 4 — Google's token check names the dashboard (`aud`)

- **Do:** press **Email sign-in is accepted**. A sign-in window opens: choose any email account
  (yours is fine). Only field names and yes/no answers come back to the card — never the address.
- **Expect:** *✓ Live check 4: email sign-in is accepted, and checked as this site's own.* (Behind
  it: `audIsOurs`, `emailVerified` and `hasEmailScope` all true, and `aud` among the fields.)
- **If the window was closed or blocked:** press the button again (it opens from your press).
- **If it says the sign-in names another site (`audIsOurs` false):** the program checks against the dashboard's own sign-in client. If the
  site uses another one, add it in the editor: **Project Settings (⚙) → Script properties → Add
  script property** → `GOOGLE_CLIENT_ID` = the client id → **Save**. If `aud` is not in `fields` at
  all, tell the maintainer (email sign-in and registration from home through this program stay
  off; password sign-in works).

### Live check 5 — a file is found by the start of its name

- **Do:** press **Open the full check page** (it opens the address with `?op=selfcheck` in a new
  tab) and find the *Name search* line. Then, back on the card, press **Files are found by name**.
- **Expect:** *✓ Name search finds a file by the start of its name* on the check page, and *✓ Live
  check 5: files are found by the start of their name* on the card (it found
  `CESTISSMOKE.name-check.json`). A new file can take a few minutes to be found: if the card says
  *not found yet*, press again in a few minutes.
- **If either fails after 30 minutes:** tell the maintainer. The office PCs will then look in each
  trainee's folder instead of searching (slower, but it works).

### Live check 6 — writing once a second for five minutes is not refused

- **Do:** in the editor, choose the function **`gateSmokeWriteRate`** → **Run**, and wait about five
  minutes until the log shows `{"writes":300,"errors":0,…}`. It writes only to its own test file.
- **Expect:** `errors: 0`; the check page then shows *✓ Write-rate check … 300 writes, 0 refused*.
- **If errors is above 0:** note `firstError`. The maintainer then makes the program and the office
  PCs write more slowly (for example, exam answers saved every two minutes instead of every minute).

### Live check 7 — a folder is found by the words in its description

- **Do:** press **Open the full check page** and find the *Description search* line.
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

**A trainee registers from home** (the program must be version 2 or later; the approval email needs
version 3):

1. On their phone, from the trainees' link or QR code: **New trainee? Register with your email
   account**. Google's own sign-in window opens; they choose their Google account. Only a Google
   account whose address Google has confirmed is accepted — there is no other way to register from
   home.
2. The form asks for their full name (first and last), their programme (those taking trainees now),
   a phone number (optional) and a password. They press **Register**.
3. At that moment the program keeps the registration in `Registrations/` **and** makes their folder
   in `Trainees/`, named "Name (student ID)". The phone says *"Your registration has reached the
   office. The office usually approves registrations within 1–2 working days. We'll email you at
   <their address> when you can sign in."* Registering again with the same Google account finds the
   same registration — never a second one, never a second folder.
4. Within a minute, the office PCs bring it into **Verify Users** (Admin Staff: *Trainee Accounts*),
   marked *"Registered from home · email account verified"*. **Activate** approves it (the trainee's
   record is made and their records go into the folder made in step 3); **Reject** turns it down
   (the folder is kept and marked).
5. Once approved, the trainee signs in at home with their Google account **or** with the password
   they chose in step 2.
6. **The email.** Right after **Activate** (or **Approve All**), the office's dashboard asks the
   program to send it: from the Centre's own Google account, to the address she registered with,
   subject *"You can sign in now — your registration is approved"*, with her sign-in link. Each
   trainee is emailed once. If the office PC goes offline before that, the email goes the next
   time any office PC opens the trainee sign-in card's **Check**, or at the daily check. It uses the
   same allowance as the emailed sign-in codes (about 100 a day on a free account); `?op=selfcheck`
   shows how many are left today.

On the Centre's own network (the Offline System) registering from home is not available: the office
creates the account there.

Limits, so nobody can fill the Centre's Drive: five tries an hour for one address; 60
registrations an hour and 200 in six hours for everybody.

## 8. Prepared assessments from home (version 4)

Nothing to set up beyond pasting version 4 (section 2). What it does, so you know what to expect:

- **Tests.** A trainee sits Theory 1 or Theory 2 at home exactly as any other test. Before she
  submits she **signs**: her full name shown in a handwritten style, and *"I confirm this is my own
  work"* ticked. The signature goes with her answers; the program marks the test and keeps her
  result, with the signature, in her folder as before.
- **Extra time.** When the Administrator (or Admin Staff with *Online Exams*) adds time for her, or
  for the whole sitting, her phone asks the program every minute while she sits the test, and her
  clock moves within a minute or two. The office PC must be signed in for the new time to reach the
  program (it sends the test's details again by itself).
- **Group practicals.** She sees her group's names (first name and initial — never another
  trainee's ID or result), the photos to take and the group's photos. Each photo is made smaller on
  her phone and sent in parts into **her own folder's `files/`**, like her coursework; the office
  copies the group's photos into the **Assessment Results** folder when it files the group's paper.
  One member hands in for the whole group and signs then; the others sign the next time they open
  it. Each trainee may send about 50 files a day (the same allowance as coursework).
- **On the Centre's own network** (the Offline System) the program answers the extra time and the
  signatures, but photos need the internet: the instructor adds them from an office computer.
