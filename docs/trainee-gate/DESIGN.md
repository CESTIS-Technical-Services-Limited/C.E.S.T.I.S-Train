# Trainee Gate — each trainee's device gets only that trainee's data

**Status (October 2026):** Stages 1–4 and 6a are built (§14–§16); registration from home and trainee
accounts made in the office (Admin Staff too) are built (§17, gate version 2). The text below §13 is the
original design; where it differs from what was built, §14–§17 say so.

**Status at Stage 1:** Stage 1 (the rules) is built, on top of the cross-device exam resume and the duplicate-stub
fold: `Core.gate` in `cestis-core.js`, the store namespace switch, the
gate's device-only keys, and their tests (§12). Nothing calls them yet, and the switch is off. The owner
questions in §13 are pending. What changed while building is in §14.

Design for review. Grounded in the integration branch
`claude/zealous-franklin-5erdiz` at `2001866`, plus two pieces of work that are not merged yet:
cross-device exam resume (`607dba8`, `963e247`) and the duplicate backfill-stub fix (`7d31ed7`,
`373a40a`).

Marking used below:
- **[verified]** means I read it in the code.
- **[unverified]** means it depends on live Google behaviour that cannot be checked in this
  environment. Stage 2 lists a smoke test for each one.

Internal name: **trainee gate**, or "the gate". The Apps Script project is "CESTIS Trainee Gate".
No screen ever uses the word (see §9).

---

## 0. The decisions, in one page

| # | Decision | Why |
|---|---|---|
| D1 | **The gate is a separate Apps Script project** from the MegaData broker. It shares only the paste-build pattern. | A different trust model: anonymous trainee traffic, against the broker's staff HMAC. `LockService.getScriptLock()` is per project, so the broker's 25 s append lock would also hold up trainee requests. The two can be upgraded and rolled back on their own. The broker is still in shadow mode. Quotas are per Google account either way, so merging them saves nothing. |
| D2 | **Staff devices publish the trainee slices.** The gate never builds slices from the main backup. | Staff devices already hold and merge everything. For Apps Script the main backup is 5–20 MB to parse (estimated from D4 volumes), and timed builds would eat the 90 min/day trigger budget and grow worse every year. The gate only serves files, checks writes and marks tests. |
| D3 | **One folder per trainee account**, named with the trainee's student ID. The folder is *identified* by the account id written in its description, because student IDs change (§1.2). | The student ID is `STU-<hash(name\|programme)>` and moves on a rename or transfer [verified, `cestis-core.js` `Core.stableStudentId`]. The account id `USR-…` is the sign-in identity and does not move. |
| D4 | **Credentials come from the accounts list the staff already publish** (`CESTIS_ACCOUNTS.json`). The gate keeps no account copy of its own. | No new publisher for credentials. Status changes, password resets and 2FA reach the gate as soon as the list is saved (it is written "the moment an account changes" [verified, `index.html` `saveAccountsLedger`]). |
| D5 | **Password sign-in is a challenge.** The device computes PBKDF2 (210 000 iterations) with the stored salt, then answers `HMAC(verifier, nonce)`. The gate does one HMAC, never PBKDF2. | PBKDF2 at 210k iterations in Apps Script would take seconds to tens of seconds per sign-in [unverified estimate]. On the device it costs what a local sign-in costs today. |
| D6 | **Trainee writes are sealed items** (`HMAC(sessionKey, item)`), delivered by any session on that device, and written to **single-writer "lane" files** in the trainee's own folder. No locks anywhere in the gate. | Nothing is lost if the trainee leaves a lab PC offline, and nobody can forge new items after sign-out. Single-writer files plus deterministic ids replace locks, so 25 trainees submitting at once do not queue. |
| D7 | **Answer keys live only in `Exam keys/` (gate-only) and on staff devices.** Papers are served only while the exam is open, by server time. Marking reads points and keys from the key file, never from the trainee's copy. | A trainee device never holds a key, and cannot see questions early or inflate points (§5.3). |
| D8 | **On a trainee device, a gate session runs in its own storage namespace** (a separate store database and key prefix). | The trainee portal code keeps working unchanged. A lab PC's Centre data is never overwritten by a slice. The Centre's sign-in token is out of reach of a gate session by construction. |
| D9 | **The Centre's server (Offline System) answers the same API** at `/_cestis/gate`, with the same `Core.gate` rules. It builds slices on request from its data files. The device chooses by origin. | One client, one rule set. Node can verify PBKDF2 itself, but uses the same challenge so the client has one path. |
| D10 | **Everything sits behind "set up and switched on" plus a kill switch.** Until then the system behaves exactly as today. | The owner rule: build in stages, and nothing that works today breaks. |

---

## 1. What is true today (the ground this stands on)

### 1.1 Facts the design relies on [all verified]

- **Sign-in is local.** `handleStudentClick` (`index.html:11298`) first calls `requireLoginSync`
  (`:11232`), which refuses sign-in until the device holds accounts beyond the three seeds. It then
  calls `findLoginAccount` (`:36006`), which may fetch the shared copy, then
  `recheckAccountBeforeRefusal` (`:36087`), `loginBlocked` (`:36023`, which uses
  `CESTISCore.accountAccess.check`), `checkPasswordWithCloud`, `publishedDefaultGate` and finally
  `tfaGateLogin`.
- **Passwords** are stored as `pbkdf2$210000$<saltHex>$<hashHex>` (`PBKDF2_ITERATIONS = 210000`,
  `index.html:6540`). Older ones are a bare 64-hex SHA-256 of `pw + '__CESTIS_SALT_2026__'`, and
  plaintext may still exist until `migratePasswordsToHash` runs.
- **Email sign-in** (`gmailSignIn`, `:12373`) uses `google.accounts.oauth2.initTokenClient` with
  the Drive client id and the scopes `userinfo.email` and `userinfo.profile`. It then fetches
  `/oauth2/v3/userinfo`.
- **Drive sync uses the Centre's own Google account** with the full `drive` scope
  (`GOOGLE_DRIVE_CONFIG.SCOPES`). A sign-in that cannot open the Centre's folder is refused
  (`NO_ACCESS_SYNC_MESSAGE`). The token is kept in `schoolDashboardGoogleAccessToken`, and
  sign-out keeps it on purpose (`clearAllSessionData`).
- **Every signed-in device holds everything.** `autoSaveToAllFolders` (`:34935`) uploads the whole
  backup to five folders every 5 s tick, trainee sessions included. `savePerUserBackup`
  (`:33466`) writes the *whole* Centre dataset, accounts included, into a "per-user" file.
- **Trainee sign-out** (`clearSensitiveStudentData`, `:8479`) trims students, results, profiles,
  attendance and transcripts. It **keeps** `voctrain_users` (every account's hash, 2FA secret and
  backup codes) and `exams` with answer keys ("read-only for students"). Staff sign-out
  (`clearAllSessionData`) also keeps `voctrain_users` and the Drive token.
- **Exams.** `Core.exams.publicQuestions` / `attemptQuestions` strip keys from the trainee's copy.
  `submitExam` (`:28421`) marks on the device with `Core.exams.mark(s.questions, s.answers,
  exam.questionData)`. `mark()` takes **points from the trainee's copy** (`Number(q.points)`).
  `canRevealAnswers` decides when correct answers may be shown.
- **In-flight resume work.** The attempt becomes a shared record, `voctrain_examAttempts`: merged
  question by question, retired by a small "submitted" record, one result per attempt
  (`attemptId`), with session grace. Attempt records carry the trainee's copy of the paper and **no
  keys**.
- **Centre server** (`Offline System/cestis-offline-server.js`). `/_cestis/token` hands the single
  data token to *any* device on the network. `/_cestis/data/<file>` then reads or writes whole page
  files, merged by `cestis-offline-store.js`. The only author check is client-side
  (`CESTISPageCloud.setAuthorPolicy`, `index.html:55133`), and it allows a trainee device to write
  *any record key*, `voctrain_exams` included. `handleHostTicket` already verifies staff PBKDF2
  passwords in Node.
- **The store** is `CESTISStore`: an IndexedDB database `CESTIS_KV` plus a localStorage mirror with
  unprefixed keys. There is an inline copy in `index.html:91` and in six staff-only sibling pages
  (Cashbook, School Fee, Clock-in, Payslip, Student Progress, Virement), and a canonical copy in
  `cestis-core.js:42`. Embedded trainee pages (Transcript-Grades,
  Qual-Plan, Cert-Transcript-Requests) load `cestis-core.js` and use the canonical copy.
- **Record merge rules** live in `Core.sync`, `Core.pageCloud.RECORD_KEYS` and `mergeBackupData`
  (`:33971`). `mergeBackupData` merges only the collections present in `backupData.data`, so a
  *partial* payload touches nothing else. That is what the staff collector reuses (§5.6).

### 1.2 Identity: why the folder is keyed by account

- A **student ID** (`s.id`, the "Student ID" shown on the profile and certificate) is
  `STU-<hash(normName|programme)>`. It changes on a rename or a transfer.
  `Core.migrateToStableIds` and `relinkDependentData` move dependants using a transient `idMap`
  that is **not persisted anywhere**.
- An **account id** (`USR-…`, from `cestisGenId`) never changes. A provable *stub* account may be
  folded into a real one and tombstoned (in-flight `backfillStubFolds`). Stubs have no password, so
  they never sign in and never get a folder.
- So: **folder name = current student ID** (as the owner asked), and **folder description =
  `cestis-trainee acct=USR-… v=1`**. The gate finds a trainee's folder by account id. The publisher
  renames the folder when that account's student ID changes. Records written by the trainee carry
  both `accountId` and `studentId`. The collector re-owns them to the account's *current* student
  ID (§5.6).

---

## 2. Data layout in Drive (Q1)

### 2.1 Folders

The gate creates its folders on its first request. It is the only creator of the root and of the
four shared folders.

```
My Drive/
  CESTIS Trainee Gate/                       ← root (id cached in Script Properties GATE_ROOT_ID)
    _gate/
      gate-state.json                        ← {format, version, createdAt, ledgerFileId, upgrades[]} — informational
    Exam keys/     key.<examId>.json         ← staff publisher writes; the gate reads; NEVER served
    Papers/        paper.<examId>.json       ← staff publisher writes; served only while the exam is open
    Rooms/         room.<roomId>.json        ← staff publisher writes; served only to members (Stage 4/7)
    Trainees/
      Tameka Richards (STU-3wfiayryzq)/      ← one per trainee account (built: "<Name> (<student ID>)", §17); description "cestis-trainee acct=USR-123 v=1"
        from-centre.json                     ← the trainee's slice (staff publisher)
        CESTISINBOX.L-<lane>.json            ← what the trainee sent, one file per session ("lane")
        CESTISINBOX.result.<attemptId>.json  ← the gate's marked result + retired attempt
        files/                               ← assignment / chat uploads (≤ 5 MB each)
    Registrations/                           ← registrations from home, CESTISREG.<USR-home-…>.json, and catalogue.json (§17)
Main folder (existing, GOOGLE_DRIVE_CONFIG.FOLDER_ID)
  CESTIS_ACCOUNTS.json                       ← existing accounts list; the gate reads it, never writes it
  CESTIS_GATE.json                           ← written by the gate at setup: {format, rootId, traineesId,
                                               keysId, papersId, roomsId, gateVersion} — how staff devices
                                               find the folders (no ids typed by anyone)
```

- **Who creates trainee folders.** The staff publisher does, on first publish for that account.
  Two staff PCs may race to create the same folder. If so, every reader (staff devices and the gate)
  takes **the oldest `createdTime` among folders whose description names the account**. The younger
  folder holds only a regenerable slice. It is marked `duplicate-of=<id>` in its description and is
  never deleted. A folder that holds any `CESTISINBOX.*` file is never trashed, by anything.
- **Finding an account's folder at the gate.** CacheService `fold:<acct>`, then Script Properties
  `fold:<acct>`, then `DriveApp.searchFolders("'<traineesId>' in parents and fullText contains
  'acct=USR-123' and trashed = false")`, oldest wins. The answer is then cached. Every use checks
  that the folder is not trashed and its description still names the account.
- **The broker's legacy walker** (`megadata/broker-appsscript/Code.gs`, `OWN_FILES`) must ignore
  `CESTIS_GATE.json`. This is a one-line change in Stage 3.

### 2.2 File shapes (all JSON, all versioned)

Each file has `format` and `version`. A reader refuses a `version` higher than it knows and keeps
its last good copy. It never treats such a file as empty. Collection names are **store keys** (the
same names `CESTISStore` and `Core.pageCloud.RECORD_KEYS` use), so a trainee device fills its
namespace from a slice directly.

**`from-centre.json`** (the slice; built by `Core.gate.buildSlice`, §3):

```json
{
  "format": "cestis-trainee-slice", "version": 1,
  "accountId": "USR-123", "studentId": "STU-1a2b3c4d",
  "builtAt": "2026-11-02T14:00:00.000Z", "builtBy": "dev-7f3a",   // device id, never a name
  "hash": "h1-9c2e…",              // Core.hashString(Core.gate.canon(data + tombstones + access))
  "maxStamp": 1793714400000,       // newest stamp the builder LOOKED AT for this trainee (§3.3)
  "inboxSeenUntil": "2026-11-02T13:58:10.000Z",   // newest inbox file this device had collected for them
  "settings": { "centreName": "…", "centreUtcOffset": "-05:00", "maintenanceMode": false,
                "gateUrl": "https://script.google.com/macros/s/…/exec" },
  "access": { "papers": ["EX-17"], "rooms": ["ROOM-4"], "files": ["1AbC…"] },
  "data": {
    "voctrain_students": [ { …own record… } ],
    "voctrain_users": [ { "id": "USR-123", "name": "…", "role": "student", "username": "…",
                          "email": "…", "programme": "…", "status": "active",
                          "twoFactorEnabled": true } ],             // no password, secret, backup codes
    "voctrain_exams": [ { "id": "EX-17", "title": "…", "course": "…", "date": "…", "time": "…",
                          "duration": 60, "passMark": 60, "status": "upcoming", "questions": 20,
                          "questionData": [] } ],                    // metadata only — never questions
    "voctrain_examResults": [ … own, every answers[].correctAnswer removed … ],
    "voctrain_examAttempts": [ … own open/retired attempts (no keys by construction) … ],
    "voctrain_attendanceRegister": [ … own marks … ],
    "voctrain_assignments": [ … programme's, grades/gradeMeta/feedback maps cut to own entry … ],
    "voctrain_submissions": [ … own … ],
    "voctrain_announcements": [ … audience = trainee of this programme, readBy cut to own … ],
    "voctrain_notifications": [ … addressed to this account or to 'student', readBy cut to own … ],
    "voctrain_calendarEvents": [ … Core.comms.forViewer(ev,'student',course) … ],
    "voctrain_classSessions": [ … this programme … ],
    "voctrain_vcSessions": [ … this programme, participant lists removed … ],
    "voctrain_resources": [ … ], "voctrain_driveResources": [ … programme-scoped … ],
    "voctrain_transcriptGrades": [ … own … ], "voctrain_unitCatalogs": [ … programme … ],
    "voctrain_transcriptProfiles": { "STU-1a2b3c4d": { … } },
    "voctrain_certTranscriptRequests": [ … own … ], "voctrain_certDownloadApprovals": [ … own … ],
    "voctrain_certTemplates": { "<course>": { …template without bgPage1/bgPage2… } },
    "voctrain_studentProfiles": { "<own keys>": { … } },
    "voctrain_support_messages": [ … own … ],
    "voctrain_chatRooms": [ … rooms they belong to, no messages … ],
    "voctrain_skillAreas": [ … their centre only … ],
    "voctrain_instructorData": [ { "name": "…", "course": "…" } ]   // their instructor, name+course only
  },
  "tombstones": { "announcements": { "AN-9": "2026-11-01T…" }, "exams": { … } }  // only ids in this trainee's pools
}
```

**`paper.<examId>.json`**: `{format:"cestis-exam-paper", version:1, examId, hash, builtAt, exam:{id,
title, course, date, time, closeDate, closeTime, duration, passMark, questionsPerPage, shuffleQuestions,
shuffleOptions, answersRelease, status, activatedAt, allowFlag, instructions}, questions:[ Core.exams.publicQuestions(questionData) ]}`
(built with the exam's real field names, §14).
Match questions carry `rows` and `choices` precomputed by the publisher. A client shuffles from
these, because re-running `publicQuestions` on an already-public copy empties `rows`/`choices`
[verified]. Stage 1 adds `Core.exams.attemptQuestionsFromPaper(questions, opts)` for this.

**`key.<examId>.json`**: `{format:"cestis-exam-key", version:1, examId, hash, exam:{…the full exam
record incl. questionData with keys, status, activatedAt…}, centreUtcOffset}`.

**`room.<roomId>.json`** (Stage 4): `{format:"cestis-chat-room", version:1, roomId, members:[accountIds],
messages:[ last 300, attachments as links ]}`.

**`CESTISINBOX.L-<lane>.json`** (written only by the gate, one writer per lane):

```json
{
  "format": "cestis-trainee-inbox", "version": 1,
  "accountId": "USR-123", "studentId": "STU-1a2b3c4d",     // as of writing; collector re-owns
  "lane": "L-k3j9…", "createdAt": "…", "updatedAt": "…",
  "records": {                                             // trainee-OWNED collections only (§5.2)
    "voctrain_examAttempts": [ … ], "voctrain_submissions": [ … ],
    "voctrain_certTranscriptRequests": [ … ], "voctrain_support_messages": [ … ],
    "voctrain_chatMessages": { "ROOM-4": [ … own messages … ] },
    "voctrain_studentProfiles": { "USR-123": { … allowed fields … } }
  },
  "ops": [ { "id": "OP-…", "kind": "read", "key": "voctrain_announcements", "recId": "AN-9", "at": "…" },
           { "id": "OP-…", "kind": "backupCodeUsed", "codeHash": "…", "at": "…" } ],
  "received": { "<itemId>": "2026-11-02T14:03:11.402Z" }   // server receipt time per item (late flags)
}
```

**`CESTISINBOX.result.<attemptId>.json`**: `{format:"cestis-gate-result", version:1, accountId,
studentId, attemptId, keyHash, markedAt, result:{…examResults record, id:"RES-G-<sha256(attemptId)[0..16]>",
attemptId, markedBy:"gate", late?, receivedAt…}, retired:{…Core.exams.retireAttempt(…)…}}`.

### 2.3 The gate's own state

| Where | What |
|---|---|
| Script Properties | `GK_SECRET` (64 hex, generated on first run if absent, never shown); `GATE_ROOT_ID`, `TRAINEES_ID`, `KEYS_ID`, `PAPERS_ID`, `ROOMS_ID`; `LEDGER_FILE_ID` (found by name; overridable); `GOOGLE_CLIENT_ID` (optional override; default is the public client id already in `index.html`); `fold:<acct>` folder cache; `spent:<acct>` backup codes spent at the gate but not yet in the accounts list. |
| CacheService (script cache) | Hot config copy (cuts Properties reads to near zero); the compact accounts index in ≤100 KB chunks, keyed by the accounts list's `lastUpdated`; nonces (120 s); 2FA tickets; rate-limit counters; folder ids; per-account access lists (from `from-centre.json`, keyed by its `lastUpdated`). |
| Drive | Only §2.1. No logs: the Apps Script *Executions* view is the diagnostic log. |

---

## 3. Who writes the slices, and when (Q2)

### 3.1 The staff publisher (`index.html`, staff sessions only)

`gatePublishTick()` runs inside `autoSaveToAllFolders` **after** a pull that `pullAllowsUpload()`
accepts. It runs only when all of these hold: the role is admin, adminstaff or instructor; the
device holds the Centre's token; `systemSettings.traineeGate.enabled`; and `CESTIS_GATE.json` was
found.

1. **When to build.** Build when `CESTISStore.writes` moved since the last build, or the pull
   changed something, or 10 minutes have passed (exam status and reveal depend on the clock).
   Otherwise do nothing.
2. **Build.** Call `Core.gate.buildAll(storeMap, nowMs, opts)`. It returns `{slices:{acct:{slice,
   h, s}}, papers:{examId:{paper,h}}, keys:{examId:{key,h}}, rooms:{…}}`. It is one pass that
   groups every collection by owner. The work is chunked (yield every 25 trainees) so an old office
   PC stays responsive.
3. **Diff.** Compare against the device-only key `cestisGatePublished` (`{path: {h, s, fileId,
   at}}`). It is device-only: add it to `DEVICE_ONLY_KEYS` in `cestis-core.js:1719`.
4. **Remote check.** At most every 5 minutes, one query: `files.list q="appProperties has {
   key='cestisKind' and value='slice' } and modifiedTime > '<last-10min>'"
   fields=files(id,appProperties,modifiedTime)`. Then decide with
   `Core.gate.publishDecision(local{h,s}, remote{h,s}|null)`:
   - `skip` when the hashes are equal;
   - `write` when `local.s > remote.s`, or the stamps are equal and `local.h > remote.h`
     (deterministic, so two devices never ping-pong);
   - `behind` when `local.s < remote.s`. This device waits for its own pull to catch up.
5. **Write.** Use a persisted queue (`cestisGatePublishQueue`) so a closed tab resumes. Throttle to
   **≤ 2 writes/s and ≤ 120 per tick**. Each write is a Drive `PATCH …?uploadType=media` on a known
   file id, or a multipart create with `appProperties {cestisKind, acct|examId, h, s}`. The
   description is set on create. Creating a folder is one `POST files` (folder MIME type) with the
   description `cestis-trainee acct=…`. A renamed student ID is one `PATCH` of the folder name.
6. **Order.** Answer keys first, then papers, then slices, then rooms. A slice that lists an exam
   is therefore never published before the gate can mark that exam.

Every staff device publishes. Diffs and the remote check stop them writing the same content twice.
An unchanged Centre costs one list query every 5 minutes per staff PC.

### 3.2 Why the gate does not build slices

It would have to parse the 5–20 MB main backup **[estimate from D4: ~800 trainees, ~4 000 results
with per-question detail, ~6 000 attendance rows, ~3 000 chat messages]** on a timer. That spends
the 90 min/day trigger budget. It nears the 6-minute run limit as the years add results (there is no
intake archive yet), and it hits DriveApp write-rate errors when 300 slices change at once. It would
also need all the audience rules in Apps Script. Staff devices already do all of this work.

The Centre's server is different: it holds the data in Node, so it builds on request (§6).

### 3.3 `maxStamp` and the "behind" rule

`s` is the newest trusted stamp (`updatedAt`, `lastModified`, `submittedAt`, `markedAt`,
`gradedAt`, tombstone times) **over every record the builder examined for this trainee**,
including records it filtered out (for example every announcement, not just this programme's).
This is what stops a device that is behind from winning. Suppose an announcement is re-targeted away
from this programme: it disappears from the slice, but its newer edit still raises `s` on the device
that saw the edit.

### 3.4 Freshness against quotas (300 trainees)

| Path | Typical latency |
|---|---|
| Staff edit → trainee sees it | publish tick (≤ 60 s) + Drive write + next trainee pull (on open/focus, every 5 min while visible) → **1–6 min** |
| Trainee write → staff PC has it | delivery (seconds) + staff collector (every 60 s) → **≤ 2 min** |
| Trainee submits test → sees result | **immediate** (the gate marks and answers in the same call) |

Quotas relied on (consumer Gmail; from Google's published Apps Script quota table as I remember it,
**to be re-checked at Stage 2**):

| Limit | Value | Confidence | Our budget for 300 trainees |
|---|---|---|---|
| Script run time per execution | 6 min | high | every gate call < 10 s |
| Simultaneous executions (per account) | 30 | medium | typical ≤ 5; deadline burst flattened by 0–45 s client jitter |
| Triggers total run time/day | 90 min | high | **0**: the gate uses no triggers |
| URL Fetch calls/day | 20 000 | high | email sign-in token checks only, ≤ 1 000 |
| Properties read+write/day | 50 000 | high | ≤ 2 000 (CacheService first) |
| Properties storage | 500 KB total, 9 KB/value | high | ~60 KB folder cache |
| CacheService | 100 KB/value, ≤ 6 h TTL, no published daily cap | medium | chunked index |
| MailApp recipients/day | 100 | high | email sign-in codes only; falls back to backup codes when spent |
| Web app request/response size | ~50 MB | **low** | requests ≤ 8 MB (5 MB file as base64 ≈ 6.7 MB) |
| DriveApp write rate | undocumented; "driveWriteVolume rateMax" errors are known in practice | medium that it exists, **low** on the number | ≤ 1 write/s sustained (exam: 25 × 1 save/min ≈ 0.4/s) |
| Drive REST from staff PCs | thousands/min per user; sustained writes "a few per second" | low–medium | ≤ 2 writes/s |
| Drive storage | 15 GB shared with Gmail | high | slices ~20–80 KB each (+ Drive's 30-day revisions), well under 1 GB. Uploads cost what they cost today. Self-check shows usage. |

Estimated gate calls: about 12 000/day typical and 20 000 on exam days (sign-ins ~900, pulls
~6 000, deliveries ~3 000, an exam for 25 ≈ 1 600). There is no published daily cap on web-app
executions that I know of **[unverified]**.

### 3.5 Answer keys

Keys exist in exactly three places:

- staff devices' stores, as today;
- the Centre's main backups in Drive, as today, and trainees no longer have Drive access;
- `Exam keys/key.<examId>.json`.

The gate reads key files at submit and review only. No API returns one. Slices carry exam metadata
with `questionData: []`. Papers carry `publicQuestions`. Results in slices have every
`answers[i].correctAnswer` removed. Correct answers reach a trainee only through `review` (§5.3),
evaluated with `Core.exams.canRevealAnswers` on **server time**.

---

## 4. Authentication at the gate (Q3)

### 4.1 Password: challenge with a device-side PBKDF2

```
device                                   gate
  ── auth.start {login} ───────────────▶  look up the account (accounts index; role 'student' only)
  ◀── {nonce, algo, iter, salt} ────────  algo 'pbkdf2-sha256' (salt, iter from pbkdf2$iter$salt$hash)
                                          or 'sha256-legacy' (no salt: device uses pw+'__CESTIS_SALT_2026__')
                                          unknown login → salt = HMAC(GK_SECRET,'fake|'+login)[0..32], iter 210000
  V = PBKDF2(pw, salt, iter) hex   (≈0.3–1.5 s on a cheap phone)  | or SHA-256 legacy hex
  proof = HMAC-SHA256(key=utf8(V), "cestis-gate-v1|" + nonce + "|" + loginLower)
  ── auth.password {login, nonce, proof} ▶ nonce must exist in cache and is consumed (single use, 120 s)
                                          expected = HMAC(utf8(stored hash hex), same msg); constant-time compare
                                          → Core.accountAccess.check(account) (pending/disabled/rejected/no-password)
                                          → refuse a published-default account (defaultPassword) or a plaintext one
  ◀── {token, sessionKey, …} | {need2fa, ticket, methods} | {error}
```

- **Rate limits** use CacheService counters. Apps Script cannot see the caller's IP.
  - 5 failures on one login → that login is locked for 15 min (`locked`).
  - More than 20 `auth.start` calls on one login in 15 min → `locked`.
  - More than 60 failures/min across all logins → `busy` for password sign-in (email sign-in is
    unaffected).
  - Lockout can be used as a denial of service against one trainee (15 min). Email sign-in still
    works, and this is accepted.
- **Ambiguous login.** One email or username matching two trainee accounts → `ask-office`, as
  `Core.accountAccess.find` would refuse.

**Threat model, plainly.**
- TLS protects transit. A captured `proof` cannot be replayed (single-use nonce), and cracking it
  offline costs PBKDF2 per guess.
- The stored hash `V` is **password-equivalent at the gate**. Whoever holds `V` can produce
  `proof`. Today every device that ever synced has every trainee's `V` (§1.1). So until a trainee's
  password is changed after the gate goes live, anyone holding an old copy of the accounts list
  could sign in at the gate as that trainee.
  - That person can already read everything on the device they took the list from, so this is not
    worse than today. But it means "only your own data" is fully true only for passwords set after
    the switch.
  - New passwords stay off trainee devices from Stage 5 on, because trainee devices no longer
    receive the accounts list.
  - The remedy is **owner question 2**: a one-time office code for each trainee's first home
    sign-in, or asking trainees to change their password once.
  - A gate-side "password change" that only proves the old `V` would not help, for the same reason.
- 2FA secrets and backup codes are also in every old accounts list, so 2FA cannot be relied on
  either until it is re-enrolled.

### 4.2 Email sign-in

- The device runs today's `initTokenClient` (same client id, same `userinfo.*` scopes, so **no
  Google verification review**) and sends `auth.email {accessToken}`.
- The gate calls `UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + t)`
  and requires all of:
  - `aud`/`azp` equal to `GOOGLE_CLIENT_ID`, so a token minted for another app is useless here;
  - `email_verified == 'true'`;
  - `expires_in > 0`;
  - a scope containing `userinfo.email`.
- It then finds the trainee account by email, case-insensitive, exactly as `handleGmailProfile` does
  (`allowNoPassword` applies here too).
- A Sign-In-With-Google ID token (`tokeninfo?id_token=`) would work the same way. Reusing the
  existing token flow keeps one code path.

### 4.3 Two-step verification

- If the account has `twoFactorEnabled` and a `twoFactorSecret`, or `emailOtpLogin`, the gate
  returns `{need2fa, ticket, methods}`. The ticket is `t2.<b64(JSON{a,exp:+5min,m})>.<HMAC>`.
- `auth.2fa {ticket, code}` checks one of:
  - TOTP: base32 secret, HMAC-SHA1 via `Utilities.computeHmacSignature`, ±1 step, a code cannot be
    reused within its step (cache `totp:<a>:<step>`);
  - a backup code: compared against `backupCodes[].code` that are unused and not in
    `spent:<acct>`;
  - an emailed code (`auth.2fa.send` → `MailApp.sendEmail` with a 6-digit code, kept hashed in the
    cache for 10 min with 6 tries).
- A spent backup code is written into the trainee's lane as an op `backupCodeUsed`. The staff
  collector marks it used in the account, and the existing union rule burns it everywhere. Until
  then `spent:<acct>` holds it.
- Email sign-in still requires 2FA, as `handleGmailProfile → tfaGateLogin` does today.

### 4.4 Sessions, expiry, revocation

- **Token:** `v1.<b64url(JSON{a, s, sid, iat, exp, cv})>.<b64url(HMAC-SHA256(GK_SECRET, "tok|"+payload))>`.
  (Built: the JSON is `Core.gate.canon` of the claims and the mac is written as 64 hex, §14.)
  - `exp` is 12 h. `pull` returns a refreshed token when less than 4 h is left and the account is
    still in good standing. The client's 60-minute idle lock and 8-hour session stay as today.
  - On a **shared computer** (§4.6) the token sits in `sessionStorage`, so closing the browser ends
    the session.
- **`cv`** is the credential version: `sha256(password|status|disabledAt|twoFactorUpdatedAt)[0..12]`
  from the accounts list. Every request compares it with the current index, which is at most 60 s
  stale. A password reset, a switch-off or a 2FA change therefore revokes every session within
  about a minute of the list being saved. Deleted accounts (`deletedUserIds`) are refused.
- **`sessionKey`** is `HMAC(GK_SECRET, "sk|"+a+"|"+sid)`. It is returned once at sign-in and kept
  in the gate namespace. Sign-out removes it.
- **`sid`** is `<iat36>.<rand>.<mac8>`. Its age can be checked without any server-side session
  table.

### 4.5 Accounts index at the gate

`gateLoadIndex()` checks `DriveApp.getFileById(LEDGER_FILE_ID).getLastUpdated()` at most once a
minute. When it changed, the gate parses the accounts list and keeps only accounts with
`role == 'student'` that are not tombstoned, through `Core.accountAccess.dropDeleted`. The compact
index stores `{login → acct}` and `{acct → {cv, status, hashField, totp?, emailOtp?, backupCodes?,
email, name}}`, in cache chunks. Today's list of ~900 accounts is ~1 MB and parses in ~1 s
**[estimate]**.

The ledger file is found by name. Exactly one non-trashed `CESTIS_ACCOUNTS.json` → that one.
Several → the one whose folder also holds `CESTIS_LMS_BACKUP.json`, newest first, and the
self-check page says which. `LEDGER_FILE_ID` in Script Properties overrides this.

### 4.6 Lab PCs and the Centre's Google session

This is outside the gate's power and is owner question 1.

On a lab PC where staff pressed Sync Now, the Centre's Google account stays **signed in to the
browser**. Anyone at that PC can then open the Centre's whole Drive in another tab, and its access
token sits in storage.

The design makes lab PCs *not need* that sign-in for trainees: trainee sign-in no longer requires
Sync Now (§7). It also adds a per-PC **"Shared computer"** setting (Stage 5). With it on, a staff
sign-out on that PC removes the Centre's records, the accounts list and the stored token, once the
final upload has succeeded (the existing `keepOnSignOut` rules still apply). Gate tokens there live
in `sessionStorage`.

Signing the Centre's account out of the browser stays an operational step for staff.

---

## 5. What trainees send back (Q5)

### 5.1 Sealed items and lanes

Every trainee write is an **item**:
`{id:"IT-<rand>", a, sid, kind, key?, rec?, op?, attempt?, createdAt, mac}` with
`mac = HMAC-SHA256(sessionKey, Core.gate.canon(item minus mac))`. `Core.gate.canon` uses sorted
keys, recursively, and a test checks it gives the same output as `MegaData.canon`.

- **Outbox.** Items wait in a **device-wide outbox** (IndexedDB `CESTIS_GATE_OUTBOX`, outside both
  namespaces). Any later session on that device delivers them, whatever its role, with
  `deliver {items}`. No token is needed: the gate checks each `mac` with `sessionKey` recomputed
  from `a|sid`.
  - Items must be younger than 60 days, judged by the `iat` inside `sid`.
  - Items from a revoked session (`cv` changed) are answered `revoked` and stay in the outbox. The
    same account's next sign-in on that device **re-seals and resends** them.
  - Nothing is ever dropped without a delivery receipt.
- **Lanes.** The gate merges accepted items into `CESTISINBOX.L-<sid>.json` with read-merge-write.
  Only the session `sid` ever writes that lane, and a device sends one lane at a time
  (`navigator.locks.request('cestis-gate-lane')`; without Web Locks, the lane id gets a per-tab
  suffix). That is why the gate needs **no locks**.
  - Within a lane, records merge by id with the newest stamp winning. Attempts merge question by
    question (`Core.exams.mergeAttempt`). Ops are de-duplicated by `id`.
  - `received[itemId]` is the server receipt time.
- **Nothing doubled.** Record ids are created once on the device. Item ids make delivery
  idempotent. A result's id is derived from its attempt. The existing double-tap guard on
  submissions stays.
- **Coalescing.** The client keeps only the newest unsent `attemptSave` per attempt. A newer save
  from the same device carries every answer, with per-question `answeredAt`.

### 5.2 What a trainee may write (`Core.gate.validateItem(item, me, slice)`)

Each item is answered with `{id, ok, reason?}`. A refused item stays in the outbox marked
`refused`, for diagnosis. It is never silently dropped.

| kind / key | Rule (me = `{acct, stu}` from the token or seal) |
|---|---|
| `rec` `voctrain_examAttempts` | `studentId == me.stu`, `status == 'open'` (only the gate retires). `examId` is in `slice.access.papers`. Every question id is in that paper. `optionOrder` is a permutation. ≤ 500 KB. |
| `rec` `voctrain_submissions` | `studentId == me.stu`. The assignment is in my slice. Staff fields (`grade`, `feedback`, `gradedBy`, `gradedAt`, `marks`) are stripped. File references are only my own uploads. |
| `rec` `voctrain_certTranscriptRequests` | `studentId == me.stu`. A new request has `status 'pending'`. The trainee may only cancel their own pending request (built: `status 'cancelled'`, §14). |
| `rec` `voctrain_support_messages` | Sender is me. ≤ 4 KB of text. |
| `rec` `voctrain_chatMessages` | `room ∈ slice.access.rooms`. Sender is me. ≤ 4 KB. Attachments are only my uploads. |
| `rec` `voctrain_studentProfiles` | The key is my account or student id. Fields are allowlisted (phone, bio, photo ≤ 300 KB, preferences). A name change becomes the existing "request to the office". |
| `op` `read` / `clearNotif` / `chatFollow` | The record id is in my slice. Only my own `readBy` entry is touched. |
| `submit` | See §5.3. |
| anything else (results, exams, attendance, accounts, other trainees' ids, other collections) | `refused: not-yours` |

### 5.3 Exams through the gate

```
My Exams (online)  ── attempt.get {token, examId} ─▶ lanes modified in the last 3 days + result files
                                                     + slice attempts → Core.exams.attemptFor / retired?
                   ◀─ {attempt | result | none} ───   "Continue your attempt (mm:ss left)"
Take exam          ── paper.get {token, examId} ──▶  examId ∈ access.papers AND
                                                     Core.exams.statusAt(key.exam, serverNow, offset) == 'active'
                   ◀─ paper | {error:'not-open'}
device: attemptQuestionsFromPaper → attempt record (startTime, deadline = Core.exams.sessionDeadline)
        draft saved on the device at once (existing draftKey), sealed attemptSave queued
saves: every 60 s, 15 s after a page change, at once on hide / sign-out  ─ deliver ─▶ lane
submit (or deadline; auto-submit jitter 0–45 s; the attempt is closed on the device at the deadline)
                   ── deliver {submit item} ─────▶  Core.gate.markAttempt(mergedAttempt, keyFile, serverNow):
                                                     • questions rebuilt FROM THE KEY by id (text, type, points);
                                                       ids not in the key → ignored and listed, never guessed (§14)
                                                     • answers taken from the attempt; optionOrder only for display
                                                     • Core.exams.mark(publicQs, answers, key.questionData)
                                                     • result.id = "RES-G-"+sha256(attemptId)[0..16], attemptId set
                                                     • late = received > windowEnd+2min OR > firstSeen+duration+2min
                                                     • CESTISINBOX.result.<attemptId>.json created if absent
                                                       (already there → return it: idempotent, no lock)
                   ◀─ {result without correctAnswer}
Review             ── review {token, resultId} ───▶  correct answers filled in iff canRevealAnswers(key.exam, serverNow)
```

- **Two devices.** If two devices submit the same attempt within a second, both compute the same
  result id. The collector keeps one (`Core.exams.oneResultPerAttempt`). A device that comes back
  later finds the retired record and shows "This test was submitted on another device", as in the
  in-flight work.
- **Mixed modes.** A lab PC still in today's mode marks on the device and writes
  `voctrain_examAttempts` and results through the main backup. The slice carries those to the gate
  session, and both modes merge with the same attempt rules.
- **First-seen time.** The gate records when it first saw an attempt (`received` of its first item)
  and uses it for the late flag only. It never refuses: answers that arrive late are kept and
  flagged for staff, matching today's `result.late` (owner question 4).

### 5.4 Assignments and files

`upload {token, name, mime, base64, purpose:'submission'|'chat', refId}` checks:

- the type is on an allowlist (pdf, images, office documents, txt, zip);
- the file is **≤ 5 MB** (today's rule);
- ≤ 50 uploads and ≤ 100 MB per account per day.

The file is written to `Trainees/<STU>/files/<refId>-<safeName>`, private, and the gate returns
`{fileId, size}`. The submission record then names `driveFileId`, as today. Staff open it with the
Centre's token, as today.

`file.get {token, fileId}` returns base64 only for ids in `slice.access.files` or the trainee's own
uploads, ≤ 10 MB. Larger resources must already be shared by link, as today.

### 5.5 Chat, profile, notices, registration

- **Chat.** Messages go into the lane as above. History comes from `Rooms/room.<id>.json`, published
  by staff and served only to members (`room.get {token, roomId, sinceEtag}`). Live delivery in a
  class still uses today's realtime channel. Away from a live class, persistence takes 1–3 min
  (owner question 3). One room file per room means a message does not trigger a rewrite of 25
  slices.
- **Profile edits and read marks** are covered by §5.2.
- **Registering from home** was reserved here (the owner first chose registration at the Centre). The
  owner has since decided it: built in §17 (`register.start` / `register.submit`, an email-account token
  only, the registration and the trainee's folder made in one request).

### 5.6 How staff PCs pick these up (`gateCollectTick()`, every 60 s, staff sessions)

1. One query:
   `files.list q="name contains 'CESTISINBOX' and modifiedTime > '<watermark − 10 min>' and trashed = false"
   fields=files(id,name,parents,modifiedTime,version),nextPageToken orderBy=modifiedTime pageSize=500`.
   The prefix match on the start of a name is documented by Drive. The 10-minute overlap covers
   search-index lag **[unverified]**. Files already seen at this `version` (device-only map) are
   skipped.
2. Download each file. Resolve the owner from the folder description's `acct`, never from the file.
   Run `Core.gate.validateItem` again on every record (defence in depth).
3. **Re-own.** Find the account's *current* student ID (`studentLinkFor`). If the account was
   folded, follow `cestisFoldedAccounts.mergedInto`. Then rewrite every `studentId` and `accountId`
   field with `Core.gate.reown`.
   - If the account is gone, or the student record is gone, the items go to a
     **"trainee work waiting for a decision"** list on the administrator's Settings card. They are
     never dropped.
4. **Merge.** Convert to a partial backup payload (`Core.gate.toPayload`: store key → payload name,
   e.g. `voctrain_submissions → assignmentSubmissions`). Then:
   - run `mergeBackupData({version:'1.0', data})`, which uses every existing record rule
     (`mergeExamResults` with `attemptId`, `mergeAttemptLists`, tombstones);
   - apply ops with `Core.gate.applyOps(store, ops)` (per-entry `readBy`, backup-code burn through
     the account rule plus `touchAccount`);
   - call `saveState()`. The normal autosave then uploads.
5. Advance the device-only watermark, and `inboxSeenUntil[acct]` for the slices. Inbox files are
   **never deleted**.

---

## 6. The Centre's own network (Q6)

- **Same API, same rules.** A new hand-maintained file, `Offline System/cestis-offline-gate.js`, is
  required by `cestis-offline-server.js` and serves `POST /_cestis/gate`. It answers the same `op`
  set. It is enforced on the server with `Core.gate`, with Node `crypto` for HMAC and TOTP.
  - **Slices** are built on request from the server's LMS data file (`CESTIS_LMS_Dashboard.json`,
    `data.voctrain_*`), parsed once per file `mtime`. Papers and keys come from the same file.
    Nothing is written to per-trainee folders.
  - **Writes.** Validated items merge straight into the data file through the existing
    `store.save` record merge. The server is the single writer. The last 40 versions are kept in
    `data/.history`, as now.
  - **Sessions** are signed with `cert/gate-secret`, generated like `host-secret`.
- **Getting only your own records on the Centre network** needs the open data token closed. While
  any device can `GET /_cestis/token`, a trainee device could still read everything. Stage 6 adds an
  administrator switch, **"Trainee devices on the Centre network get only their own records"**:
  - When on, the server **rotates** `cert/lan-token`.
  - `/_cestis/token` then answers only to `POST {username, password}` of a staff login. This is the
    same check `handleHostTicket` already does.
  - Staff devices fetch the new token as part of staff sign-in (a server-checked password replaces
    the pre-sign-in Sync Now for staff on the Centre network). Trainee devices use `/_cestis/gate`
    only.
  - When off, everything works as today.
- **How a device chooses.** By origin.
  1. If the page was served by the Centre's server (`CESTISPageCloud.lan()` true), the gate base is
     `/_cestis/gate` on the same origin.
  2. Otherwise, the online gate address (device-only `cestisGateAddress` from the trainee link or
     QR, else `systemSettings.traineeGate.url`).
  3. Otherwise, today's sign-in.

  The online site and the Centre's server are different origins, so their gate namespaces never
  mix.

---

## 7. What a trainee device keeps, lab PCs, and migrating devices that hold everything (Q4)

### 7.1 Gate namespace

- **Switching namespace.** The store IIFE, in the canonical `cestis-core.js` copy and the
  `index.html` inline copy (kept identical by a test), reads the unprefixed control key
  `localStorage.cestisGateNs` before opening. When it is set (`"g1"`):
  - the database is `CESTIS_KV__g1`;
  - every mirrored localStorage key is prefixed `g1::`;
  - `keys()`, `key()`, `length` and the `storage` listener all work inside the prefix.

  Embedded trainee pages use the canonical copy, so they follow the same switch. The six staff-only
  sibling pages (Cashbook, School Fee, Clock-in, Payslip, Student Progress, Virement) keep their own
  copies and stay in the main namespace; they already say "sign in first" without a staff dashboard
  session.
- **Entering and leaving.** Gate sign-in sets the control key and reloads into the namespace.
  Sign-out clears it and reloads.
- **What the namespace holds:**
  - the slice, written per key (read-only keys replaced, trainee-writable keys merged with any local
    unsent records);
  - the overlay from `pull`;
  - exam drafts (`cestisExamSession__…`);
  - the gate token and `sessionKey` (device-only keys).

  It holds no accounts list, no other trainee, no keys, and no Centre token. The token lives in the
  main namespace, which a gate session never opens, so autosave, Drive and Centre-server data calls
  have nothing to work with. `enterApp` additionally checks `cestisGateMode` and never starts
  `autoSaveToAllFolders` or `CESTISPageCloud`.
- **Sign-out.** Once the outbox has nothing of this account's left unsent, the namespace database
  and the `g1::` keys are deleted. Sealed items live in `CESTIS_GATE_OUTBOX`, so the namespace can
  always be deleted.

### 7.2 Lab PCs

- **Trainee sign-in on any PC.** When the gate is on, trainee sign-in uses the gate: no Sync Now,
  no accounts needed. The trainee card's sign-in no longer calls `requireLoginSync` in gate mode.
  The Centre's records already on the PC (main namespace) are not read, not changed and not wiped
  by a trainee session.
- **Fallback.** If the gate cannot be reached, a PC whose main namespace holds the Centre's records
  (device kind `staff`) may fall back to today's local sign-in. This keeps classes running in an
  outage. An administrator can switch the fallback off (`traineeGate.strict`, owner question 5).
  A trainee-only device never falls back.
- **Staff.** Nothing changes by default. With "Shared computer" on (§4.6), staff sign-out removes
  the Centre's records from that PC once uploaded, and the next staff sign-in needs Sync Now, as on a
  new PC.

### 7.3 Clean-up of devices that already hold everything

The device-only key `cestisDeviceKind` is set to `staff` the first time a staff role signs in after
Stage 5 ships.

`Core.gate.cleanupPlan(storeKeys, markers)` returns `{remove:[keys], keep:[keys], defer:reason|null}`.
It runs at the first gate sign-in, and only when all of these hold:

- the gate is on and the trainee has just signed in through it;
- `cestisDeviceKind` is not `staff`;
- the "pending upload" note is clear, or holds only that trainee's role.

Then:

1. **Unsent own work is sent first.** The exam outbox (`examOutboxRead`), drafts, undelivered
   support messages, unsent requests and submissions, chat and profile keys
   (`voctrain_user_<id>_*`), and pending registrations made on this device. Records belonging to
   *the signed-in trainee* are sealed under the new session and delivered. Records belonging to
   other trainees go to `cestisGateQuarantine` (by owner) and are delivered when that owner signs in
   through the gate on this device.
2. **Only after delivery receipts** are the Centre collections removed from the main namespace:
   `voctrain_users`, every other `voctrain_*` record collection, `cesti*` fee, payroll and finance
   keys, chat images, certificate images, and the stored Centre token.
3. When anything is unclear (unreadable keys, a staff note, a failed delivery): **defer**, keep
   everything, try at the next sign-in.

Stage 5 ships first in **report-only** mode. It logs the plan and shows the administrator "N devices
would be cleaned" for a week, and only then removes anything (owner question 6).

A lab PC that has not seen a staff sign-in since the update will be treated as a trainee device and
cleaned. Nothing unsent is lost; staff just press Sync Now again.

---

## 8. Offline at home (Q7)

- **Reading.** The namespace keeps the last good slice, so the portal opens offline and shows "Last
  updated 10:42".
- **Writing.** Every change is first saved on the device: the draft and the record in the
  namespace, plus a sealed item in the outbox. Delivery retries on `online`, on `visibilitychange`,
  every 30 s while there are items and the page is visible, and at sign-in, with backoff
  2 s → 5 min.
  - A delivery is confirmed per item. An item whose receipt was lost is simply delivered again
    (idempotent).
  - Coalescing keeps the outbox small.
- **Exams.** The paper must be fetched online once, at start. After that the attempt runs fully
  offline. Submit while offline closes the attempt locally, queues the submit, and says the test
  "will be sent to the office when you're back online" (the in-flight wording). The result arrives
  when delivered. It is flagged late only if it arrived after the window plus 2 minutes.
- **Token expired while offline.** Work keeps being saved and sealed with the session key, which
  does not expire with the token. When back online the device delivers, then asks the trainee to
  sign in again to read.
- **Nothing lost, nothing doubled:** see §5.1 for ids, receipts, re-sealing and idempotent results.

---

## 9. What people see (Q9)

The owner rule applies: no screen names a place. `tools/scan-ui-wording.js` must stay at 0.
`cestis-gate-client.js` is a root browser file, so it is scanned automatically.

| Situation | Wording |
|---|---|
| Trainee card when the gate is on | No "Sync Now" requirement. "Sign in" and "Sign in with your email account" as today. |
| Signing in | "Signing in…", then "Getting your records…" (first time only) |
| Wrong password | "That email/username and password do not match." |
| Locked | "Too many tries. Wait 15 minutes, or ask the office." |
| Pending | Today's full "Awaiting Approval" screen (the gate returns `pending`) |
| Switched off | "This account has been switched off. Please contact the office." |
| Not ready (no slice yet) | "Your records are being prepared. Try again in a few minutes, or ask the office." |
| Cannot reach the gate | "Could not sign in right now. Check your connection and try again." |
| Offline, signed in | Sync chip: "Saved here — will be sent when you're back online (3 waiting)" |
| Exam saved / offline submit | "Answers saved" / "Your test is submitted here and will be sent to the office when you're back online." |
| Correct answers not yet released | Today's review, without the right answers, and "Correct answers are shown once the test has closed." |
| Admin Settings card | **"Trainee sign-in from anywhere"**. Status ("Not set up", "Ready — version 1", "Needs attention: …"). Buttons: *Copy the setup code*, *Setup sheet* (opens `trainee-gate/SETUP.md`), an *Address* field, *Check*, *Turn on / Turn off*, *Shared computer* (per PC). "Trainees' sign-in link" with a QR and *Print*. "Records sent to trainees: 2 min ago (0 waiting)". "Trainee work waiting for a decision: 0". |
| QR caption | "Sign in on your own phone: scan this code." |
| Trainee card, gate on (§17) | "New trainee? Register with your email account" (today's "Register here" is not offered); on the Centre's network: "New trainee? Ask the office to create your account." |
| Registering (§17) | "Waiting for your email account…", "Checking your email account…", the form "Register as a Trainee", "Sending your registration to the office…", then the pending screen: "Your registration has reached the office…" |
| Registering refused (§17) | "You already have an account — sign in with your email account or your password." · "Registration is not open just now. Please ask the office." · "Too many registrations just now…" · "Registering is not available here. Please ask the office to create your account." |
| Verify Users (§17) | "Registered from home · email account verified"; Admin Staff: the page "Trainee Accounts"; both: "+ Add Trainee Account" |

---

## 10. Setup, address, self-check, upgrades (Q8)

### 10.1 One-time steps for the administrator (~10 min)

The setup sheet (`trainee-gate/SETUP.md`) is a document, not a screen, so it may name Google.

1. On the office PC, sign in to the dashboard as an administrator. Go to **Settings → Trainee
   sign-in from anywhere → Copy the setup code**. This copies `trainee-gate/PASTE-GATE.gs`, served
   by the site.
2. In the same browser, signed in to the **Centre's Google account**, open `https://script.new`.
3. Click **Untitled project**, type `CESTIS Trainee Gate`, then **Rename**.
4. Click in the code. Press **Ctrl+A**, **Delete**, **Ctrl+V**, then **Ctrl+S**.
5. **Deploy** (top right) → **New deployment** → the gear next to *Select type* → **Web app**.
   Description `Trainee gate`. *Execute as*: **Me**. *Who has access*: **Anyone**. Click **Deploy**.
6. **Authorize access** → choose the Centre's account → **Advanced** → **Go to CESTIS Trainee Gate
   (unsafe)** → **Allow**. This is the normal warning for an account's own script. The scopes are
   Drive, external requests (for email sign-in) and send-mail (for email codes).
7. Copy the **Web app URL** (it ends in `/exec`) and click **Done**.
8. Back in the dashboard card, paste it into **Address** and press **Check**. The first check makes
   the gate create its folders, its secret and `CESTIS_GATE.json` (§2.1). Expect **"Ready —
   version 1"** and a count of trainee accounts.
9. Press **Turn on**. Print the trainees' QR, or show it on the lab screens.

Nobody types a secret. `GK_SECRET` is generated inside the script on first run and never leaves
Script Properties.

### 10.2 How the address reaches devices (never in the repo)

- **Staff PCs and lab PCs:** `systemSettings.traineeGate = {url, enabled, strict, setAt, setBy}`.
  The administrator's device publishes it, and it merges everywhere through the existing settings
  rule (`Core.mergeSystemSettings`).
- **Trainee phones at home:** the link or QR is
  `https://<site>/index.html#gate=<base64url(url)>`. The **fragment** is never sent to GitHub. The
  device stores it in the device-only `cestisGateAddress`. Every slice carries
  `settings.gateUrl`, so it stays current.
- **Keeping the address.** Upgrades use *Manage deployments → Edit → New version* (§10.4), so the
  URL never changes. If it ever must change, re-share the QR. The old URL keeps working until it is
  archived.

### 10.3 Self-check

- `GET <url>` (or `?op=health`) returns JSON: `{ok, service:'cestis-trainee-gate', version,
  protocol:[1], time, ready:{secret, folders, ledger, ledgerUpdated, trainees}, accepting}`.
- `GET <url>?op=selfcheck` returns a small page for the administrator with ✓/✗ lines:
  - version;
  - secret present;
  - folders present;
  - accounts list found (N trainee accounts, updated at …);
  - slices published (M of N, oldest …);
  - answer keys (K exams);
  - Drive storage used (`DriveApp.getStorageUsed()`);
  - email codes left today (`MailApp.getRemainingDailyQuota()`).

  It shows counts only: no names, no ids.
- The dashboard card calls `health` on **Check** and once a day on the administrator's device.
- `Core.gate.selfTest()` runs the token, HMAC and TOTP known-answer vectors inside the script on
  `selfcheck`. A runtime that computes them differently fails loudly.

### 10.4 Versions and upgrades

- `GATE_VERSION` (an integer) lives in `Gate.gs`. `protocol: [1]`.
- The client sends `{v:1, client:'<?v= stamp>'}`. The gate may answer `client-too-old`, and the
  client reloads (the service worker is network-first).
- The card shows "A newer version is available" when the site's expected `GATE_VERSION` is higher
  than `health.version`.
- **Upgrade:** *Copy the setup code* → open the project at `script.google.com` → Ctrl+A, paste,
  save → **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy**. The URL is
  unchanged. This is the same as the broker's README.
- Slices carry `version`. Readers refuse an unknown higher version and keep the last good copy.
- All changes are additive.

### 10.5 Before setup, and off switches

- Until the address is set and **Turn on** is pressed, nothing calls the gate. No folders are
  created and no publisher or collector runs: today's behaviour, byte for byte.
- **Kill switches:**
  - *Turn off* in the card. Publisher and collector go idle, and trainee sign-in returns to today's
    flow.
  - A file named `gate-off` next to `index.html`, fetched at load like `sw-disable`. It forces
    today's flow everywhere.
  - Archiving the deployment in Apps Script.

  Outboxes are kept through all of these, and delivered when the gate is back.

---

## 11. Code layout

| File | Contents |
|---|---|
| `cestis-core.js` (+ generated `Offline System/` copy) | **New `Core.gate` module, appended at the end** to avoid conflicts. Synchronous only; crypto is injected (`hmacHex(keyBytes,msg)`, `sha256Hex`, `sha1Bytes`). Contains: `canon`, `buildSlice`, `buildAll`, `buildPaper`, `buildKey`, `buildRoom`, `publishDecision`, `validateItem`, `applyOps`, `toPayload`, `reown`, `markAttempt`, `redactResult`, `token.sign/verify`, `proof.expected`, `totp.verify`, `cleanupPlan`, `selfTest`. Also `Core.exams.attemptQuestionsFromPaper`, and `Core.enrolment.courseMatch` (the pure core of `instructorCourseMatch`, `index.html:15625`, which stays as a wrapper). Store IIFE: the namespace switch. `DEVICE_ONLY_KEYS`: the gate keys. |
| `trainee-gate/Gate.gs` | Apps Script I/O only: `doGet`, `doPost`, DriveApp/Cache/Properties/UrlFetch/MailApp/Utilities adapters. No business rules. |
| `trainee-gate/build-paste.js`, `PASTE-GATE.gs` (generated), `SETUP.md` | Same pattern as `megadata/broker-appsscript/`. The paste is `appsscript-prelude.js` (reused) + `cestis-core.js` + `Gate.gs`. **[unverified: whether a ~0.7 MB paste is accepted and how long the cold start takes]**. Fallback: the builder includes only an allowlist of `Core` modules, with a drift test against `cestis-core.js`. |
| `cestis-gate-client.js` (new, root) | Browser client: `CESTISGate.configure/signIn/twoStep/pull/paper/attempt/deliver/review/upload/fileGet/roomGet/signOut`, the outbox (IndexedDB), lanes (Web Locks), backoff, and namespace enter/leave. |
| `index.html` | Staff: `gatePublishTick`, `gateCollectTick`, the Settings card, the QR. Trainee: gate sign-in on the trainee card, the pull apply, gate-mode exam, assignment and profile paths, sign-out. Clean-up and "Shared computer". |
| `Offline System/cestis-offline-gate.js` (hand-maintained) + `cestis-offline-server.js` | `/_cestis/gate`, the staff-only token switch. |
| `megadata/broker-appsscript/Code.gs` | Ignore `CESTIS_GATE.json` in `OWN_FILES`. |

---

## 12. Stages (Q10)

Every stage ships on its own, keeps today's behaviour when the gate is off, and runs `npm test`,
`npm run test:syntax`, `node tools/scan-ui-wording.js` (0) and `npm run build:offline`.

**Prerequisite.** The in-flight exam-resume work (`607dba8`/`963e247` + WIP) and the backfill-stub
fix should be merged before Stage 1 lands. Stage 1 calls `mergeAttempt`, `attemptFor`,
`retireAttempt`, `oneResultPerAttempt` and the ledger-write fix. If they are late, Stage 1 is
written against their API and rebased.

### Stage 1 — The rules (pure, no visible change)
- **Files:** `cestis-core.js` (`Core.gate`, `attemptQuestionsFromPaper`, `courseMatch`, the store
  namespace switch **disabled unless the control key is set**), `Offline System/cestis-core.js`,
  `package.json`.
- **Tests (Node):**
  - `tests/gate-slice.test.js`. A **privacy property test**: for a generated Centre (40 trainees,
    3 programmes, exams of every type, chat, grades), each slice's JSON contains no other trainee's
    `STU-`/`USR-` id, name, email, hash, 2FA secret or backup code. It also contains no
    `correctAnswer`, `pairs`, `distractors` or `tolerance` anywhere, and no `questionData` items.
    Plus determinism (the same input gives the same hash) and the `maxStamp` rules.
  - `tests/gate-validate.test.js` (every row of §5.2, plus a fuzzed foreign `studentId`).
  - `tests/gate-auth.test.js`:
    - the proof against PBKDF2 and legacy hashes (Node `crypto`);
    - token sign/verify/expiry and `cv` revocation;
    - TOTP RFC 6238 vectors;
    - `canon` parity with `MegaData.canon`.
  - `tests/gate-exam.test.js`:
    - tampered points and unknown ids are ignored;
    - the deterministic result id;
    - the late flag;
    - redaction against `canRevealAnswers`;
    - resume across lanes.
  - `tests/gate-collector.test.js`:
    - `toPayload` and `reown` after a rename and after an account fold;
    - the unassigned queue;
    - a second run is idempotent.
  - `tests/gate-cleanup.test.js` (never removes unsent work; defers when unsure).
  - `tests/store-namespace.test.js` (the switch, the prefixes, the inline/canonical copies agree).
- **Risk:** low. **Rollback:** revert.

### Stage 2 — The gate script (deployable; nothing calls it yet)
- **Files:** `trainee-gate/*` (new directory only), `package.json` (`build:gate`).
- **Tests:**
  - `tests/gate-appsscript-vm.test.js`. The real `PASTE-GATE.gs` runs in `vm` with fakes for
    DriveApp (an in-memory folder tree), CacheService, PropertiesService, UrlFetchApp (tokeninfo
    scripted), MailApp and Utilities (signed bytes, as in `megadata-appsscript-vm.test.js`). It
    covers health and first-run setup, the password challenge, email sign-in, 2FA, lockout, pull and
    overlay, deliver (ok, refused, revoked, re-seal), submit (idempotent, concurrent double submit),
    review, upload limits, and paper not-open.
  - A drift test for `PASTE-GATE.gs`.
- **Live smoke checklist** (in `SETUP.md`, run once by whoever deploys). Each item checks one
  unverified fact:
  1. the paste size is accepted, and cold-start time;
  2. CORS from GitHub Pages with a `text/plain` POST;
  3. a 7 MB POST;
  4. `tokeninfo` reports `aud`;
  5. Drive accepts the `name contains 'CESTISINBOX'` query;
  6. no `driveWriteVolume` errors at 1 write/s for 5 minutes;
  7. `searchFolders` finds `fullText` text in a folder description.
- **Risk:** medium (live Apps Script cannot be run here). **Rollback:** archive the deployment.

### Stage 3 — Staff side: publish and collect
- **Files:** `index.html` (staff sync region + Settings card; staff sessions only),
  `megadata/broker-appsscript/Code.gs` (one line) + rebuilt broker paste, generated Offline System.
- **Tests:**
  - Node: `tests/gate-publisher.test.js`, which extracts the page functions the way the existing
    suites do. It covers the throttle, the persisted queue, `publishDecision` with two simulated
    devices (no ping-pong, a stale device never wins), folder rename on a student-ID change, and the
    duplicate-folder oldest-wins rule.
  - Browser: `tests/browser/gate-staff.js` with `tests/browser/fake-drive.js` (from the in-flight
    work). The admin turns the gate on; slices, papers and keys appear; a hand-made inbox file is
    collected and merged once; the Settings card works; a staff PC with the gate off makes **zero**
    extra Drive calls.
- **Risk:** medium (Drive write volume, CPU on old PCs: chunked and throttled). **Rollback:** *Turn
  off*. The folders stay and do no harm.

### Stage 4 — Trainees sign in and work through the gate
- **Files:** `cestis-gate-client.js` (new), `index.html` (landing trainee card, the pull apply,
  gate-mode exam/assignment/profile/notice/chat paths, sign-out), `sw.js` (precache the client;
  `script.google.com` is already never touched), generated Offline System.
- **Tests:** `tests/browser/gate-flows.js` (`npm run test:browser:gate`). It uses **fake-gate**: the
  real `PASTE-GATE.gs` in Node `vm`, with a DriveApp adapter **over the same FakeDrive** the staff
  PC writes through. Routes cover `https://script.google.com/macros/s/FAKE/exec` and `tokeninfo`.
  1. Staff PC publishes.
  2. A phone context (empty storage, link with `#gate=`) signs in by password, by email account,
     and with 2FA.
  3. The phone's IndexedDB and localStorage dumps hold **no other trainee's id, no account hashes
     and no answer keys**.
  4. The phone takes an exam; the network drops mid-exam (route abort); a second context resumes
     with the same deadline; one submit; staff see one result.
  5. A lab PC holding the Centre's data: a trainee gate session leaves the main namespace
     byte-identical.
  6. Gate unreachable → today's fallback on the lab PC, refusal on the phone.
  7. Kill switch → today's sign-in.
  8. A sign-out with an unsent submit → delivered by the next session.
- **Risk:** high (largest surface). It is behind *Turn on*. **Rollback:** *Turn off* / `gate-off`.
  Outboxes are kept.

### Stage 5 — Clean-up and shared computers
- **Files:** `index.html` (sign-out paths `logout`, `clearSensitiveStudentData`,
  `clearAllSessionData`; landing; `cestisDeviceKind`; "Shared computer"), generated Offline System.
- **Tests:**
  - `tests/browser/upgrade-no-data-loss.js` extended. A device written by today's build holds
    everything plus an unsent exam result, a draft and a support message. After the first gate
    sign-in, the unsent items are delivered **before** anything is removed, then the Centre
    collections are gone. Report-only mode removes nothing.
  - The shared-computer staff sign-out keeps unsent staff work (the existing `keepOnSignOut` cases).
- **Risk:** medium–high (it deletes local copies). Report-only first. **Rollback:** switch off.

### Stage 6 — The Centre's network
- **Files:** `Offline System/cestis-offline-gate.js` (new, hand-maintained),
  `cestis-offline-server.js`, `cestis-page-cloud.js` (staff token after a server-checked sign-in),
  `index.html` (base selection by origin, staff sign-in fetches the token), Offline System README.
- **Tests:**
  - `tests/gate-lan.test.js` (scratch `CESTIS_DATA_DIR`, every op, merges into the data file,
    history kept).
  - `tests/browser/offline-lan-smoke.js` extended: the switch on means a trainee device cannot
    `GET /_cestis/token` or any `/_cestis/data/*`, and staff sign-in still works.
  - `lan-*` suites still pass with the switch off.
- **Risk:** medium (changes the staff flow on the Centre network, only when switched on).
  **Rollback:** switch off (the token is rotated again).

### Parallel work

```
Stage 1 ──┬─▶ Stage 2  (trainee-gate/ only)            ─┐
          ├─▶ Stage 3  (index.html: staff regions)      ├─▶ Stage 4 ─▶ Stage 5
          └─▶ Stage 6a (Offline System server files)   ─┘          └─▶ Stage 6b (client: base by origin, staff token)
```

- **Stages 2, 3 and 6a** can be built at the same time by three agents. Their files do not overlap.
  Stage 3 touches only staff-only functions and the Settings page.
- **Stage 4 and Stage 3** both edit `index.html`, but in different regions (landing/trainee/exam vs
  autosave/settings). Merge 3 first.
- **Stage 1 must merge first.** It is the only stage that edits `cestis-core.js`; later stages only
  call it.
- Regenerate `Offline System/` after every merge (`npm run build:offline`). The parity test fails
  otherwise.

Optional, after these:
- room files for chat history (if not finished in Stage 4);
- the trainee's own fee statement in the slice;
- registration from home;
- one-time office codes and verifier rotation (owner question 2);
- password change at home.

---

## 13. Risks and questions for the owner (Q11)

**Questions (plain):**

1. **Lab PCs.** When staff press "Sync Now" on a lab PC, the Centre's account stays signed in to
   that browser, and anyone at that PC can open all the Centre's files. With this change, trainees
   no longer need it on lab PCs. Should lab PCs become "shared computers", where staff sign-out
   removes the Centre's records from the PC and staff press Sync Now each time? Should staff also
   sign the Centre's account out of the browser after use?
2. **Old account lists.** Every computer that synced before holds a copy of every trainee's
   password check. Until a trainee changes their password once, or signs in with their own email
   account, someone with such a copy could sign in from home as that trainee. Accept that for now,
   or have the office hand each trainee a one-time code for their first sign-in from home?
3. **Chat at home.** Live-class chat stays instant. Other messages may take 1–3 minutes to be saved
   or seen. Is that acceptable?
4. **Lost connection at the deadline.** Proposed: answers that arrive late are kept and marked "sent
   after the deadline" for staff to decide (as today), not refused. Agree?
5. **Internet down at the Centre.** Should lab PCs that already hold the Centre's records let
   trainees sign in the old way (classes go on, but that PC uses its own copy, answer keys
   included)? Or refuse until the connection is back?
6. **Clean-up.** For one week after it ships, devices only *report* what they would remove. Then
   they remove the other trainees' records and the answer keys. Agree to the one-week report?

**Risks:**
- **Live Google behaviour is untested here.** These are listed as the Stage 2 smoke items: paste
  size, CORS, POST size, write rate, query prefix and description search, and `tokeninfo`.
  Fallbacks are designed for each one.
- **Answer keys before the switch.** Every old device that synced still has some answer keys. The
  gate protects exams created after the switch fully, and earlier ones from the moment devices are
  cleaned (Stage 5). It cannot recall copies already taken.
- **Freshness depends on a staff PC being online.** If no staff device is open, trainees see the last
  published state. Their writes still land in their folders and are collected later. The self-check
  shows "oldest slice".
- **Scale of the publisher** on old office PCs: chunked, throttled and diff-only. Measured in
  Stage 3's browser test with 300 generated trainees.
- **A single 30-concurrent-execution limit per Google account** is shared with the broker if both
  are deployed. Deadline jitter is the mitigation.

---

## 14. Stage 1 as built — the API, and changes during build

### 14.1 `Core.gate` (end of `cestis-core.js`; both builds)

Pure and synchronous. No storage, no network, no clock of its own: every rule that depends on time
takes the time as an argument. `crypto` is `{ hmacHex(keyBytes, msg), sha256Hex(msg), sha1Bytes(bytes) }`
(HMAC-SHA256 hex of a UTF-8 message; SHA-256 hex; raw SHA-1 as 20 bytes). A key is always the UTF-8 bytes
of its text: a hex secret is used as written, never decoded, so every side derives the same bytes.

| Function | What it does |
|---|---|
| `canon(v)` | Sorted-key canonical JSON; byte-identical to `MegaData.canon` (tested). |
| `hashOf(v)` | `'h1-' + Core.hashString(canon(v))` — the content hash publishers compare (no crypto needed). |
| `prepare(storeMap, nowMs, opts)` / `sliceFor(ctx, acct)` | One pass over the Centre's records, then one trainee's slice; a staff device yields between `sliceFor` calls (the "chunked" publisher). `opts: {builtBy, gateUrl, inboxSeenUntil, findSkill, folds, relinked}` (`relinked`: `{oldStudentId: newStudentId}` moves the caller kept, §14.4). `ctx.formerIds` / `ctx.formerUnsure`: each trainee's former student IDs, and those two could claim. |
| `buildAll(storeMap, nowMs, opts)` | `{slices:{acct:{slice,h,s,scrubbed}}, papers:{examId:{paper,h}}, keys:{examId:{key,h}}, rooms:{roomId:{room,h}}, unlinked:[acct], s}`; `opts.only` limits it to some accounts. |
| `buildSlice(storeMap, acct, nowMs, opts)` | One slice (the Centre's machine builds on request), or `{error:'not-found'\|'unlinked'}`. |
| `buildPaper(exam, nowMs)` / `buildKey(exam, offset)` / `buildRoom(room, msgs, members, nowMs)` | The three published file shapes of §2.2. |
| `publishDecision(local{h,s}, remote{h,s}\|null)` | `'skip'`, `'write'`, `'behind'`, or `'keep'` (same moment, the published copy's hash wins the tie). |
| `sliceExamStatus(exam, nowMs, offset)` | `Core.exams.statusAt` for a slice's exam (whose `questionData` is always empty: the count `questions` decides "has questions"). |
| `paperOpen(keyFile, nowMs)` | May the paper be served now (the exam `active` on the given clock)? |
| `eligible(account)` / `studentFor(account, students)` | Who gets a slice; the trainee record an account belongs to (the dashboard's own lookup order). |
| `validateItem(item, me, slice, opts)` | §5.2. `{id, ok, reason?}` plus what to keep (`{key, rec, recId}`, `{op}`, `{attempt}`). `slice` null = ownership and shape only (the collector's re-check). `opts: {papers, paper, ownUploads, lane}`. |
| `applyOps(store, ops, me)` | Read / clear / follow marks and a spent backup code, in place; idempotent; `{applied, skipped, changed, touchedAccounts}`. |
| `toPayload(records)` | `{version:'1.0', data:{payloadName:…}, records:{storeKey:…}}` for `mergeBackupData` (+ the request queue's record merge). |
| `foldMap(input)` / `resolveOwner(acct, cx)` / `reown(records, from, to)` | Account folds (`cestisFoldedAccounts`, a plain map, or `backfillStubFolds()`'s answer); whose work it is now — the dashboard's fold log first, then `Core.accountAccess.backfillStubFolds()` for stubs not folded yet (a circle of folds is `'ambiguous'`); rewriting their ids. `prepare` counts a folded stub's id as the trainee's own. |
| `collect(files, cx)` | The collector's pure step (§5.6 steps 2–4): owner from the folder, re-check, re-own, payload, ops, the unassigned list, files seen, watermark. |
| `markAttempt(attempt, keyFile, nowMs, opts)` | §5.3: `{result, retired, keyHash, file}` or `{error}`; `resultId(attemptId, crypto)`. |
| `redactResult(result, exam, nowMs, offset)` | The right answers only when `Core.exams.canRevealAnswers` allows on the given time. |
| `fillAnswers(result, keyFile)` | The right answers put back into a result from the exam's key file, each as `Core.exams.mark` gives it from the key's own question, in marking's field order (§14.4). An answer that has one keeps it; a question the key no longer has stays without; another exam's key, a paper or nothing fills nothing. A copy. `review` runs `redactResult(fillAnswers(result, key), …)` on both gates. |
| `resumeAttempt({lanes, results, slice}, stu, examId)` | `attempt.get`: `{state:'result'\|'retired'\|'attempt'\|'none', …}`. |
| `token.sign/verify/claims`, `cv`, `sid.make/check`, `sessionKey` | §4.4. |
| `seal(item, key, crypto)` / `sealOk(item, key, crypto)` | §5.1. |
| `proof.challenge/message/make/expected/verify/parse` | §4.1. |
| `totp.code/verify/hotp/base32`, `codeHash(code)` | §4.3. |
| `cleanupPlan(storeKeys, markers)` | §7.3: `{remove, keep, send, defer}`. |
| `selfTest(crypto)` | §10.3: `{ok, version, checks:[{name, ok}]}` (canon, SHA-256, HMAC-SHA256 RFC 4231, TOTP RFC 6238, a golden token, the proof). |
| `indexAccounts(accounts, deletedUserIds, crypto)` / `lookupLogin(idx, login, opts)` | §4.5, moved here from both gates (§14.4): the accounts index `{n, a:{id:{cv, st, pw, sd, tf, eo, em, bc, sdi}}, user, mail}` (trainees only, deleted dropped, the copy that can sign in); which account a login names → `{none}` \| `{id, e}` \| `{ambiguous}` (`opts: {emailOnly, allowNoPassword}`). |
| `credentialRefusal(entry, via)` / `twoStep(entry, unusedCodes, canEmail)` | §4.1–4.3: `null` or `{error, why?}` once the credential is right; `{needed, methods}` (`unusedCodes` an array, or a function asked only when a second step is needed). |
| `ticketMake(claims, secret, crypto)` / `ticketRead(ticket, secret, crypto, nowMs)` | §4.3: `t2.<b64url(canon {a, cv, exp, m, via, n})>.<HMAC hex>`; read back with `mac` (its seal's first 32 hex) or `{error:'bad-ticket'\|'expired'}`. Single use and tries stay with each gate. |
| `sidRand(cv, rand12)` / `sidCv(sid)` | §4.4: a session id's random part begins with the credential version (`sid.make` seals it); `sidCv` reads it back, `''` otherwise. |
| `laneMerge(lane, v, nowMs)` / `laneStamp(rec)` / `laneFirstSeen(lane, attemptId, nowMs)` / `firstSeenOf(lanes, ids, nowMs)` | §5.1, §5.3, moved here from Gate.gs: what a session's lane keeps of what `validateItem` took (attempts by `mergeAttemptLists`, profiles by key, chat by room and id, the rest by id; newest `laneStamp` wins, a tie the one sent last); when an attempt was first seen (once); the earliest over every lane. |
| `DEVICE_KEYS`, `FORMAT`, `VERSION`, `NS_KEY`, `KEY_NAMES`, `PAYLOAD_NAMES`, `utf8`, `toHex`, `fromHex`, `b64url`, `unb64url`, `same` | Constants and byte helpers. |

Also: `Core.exams.attemptQuestionsFromPaper(questions, opts)` and `Core.enrolment.courseMatch(a, b,
findSkill)` (index.html's `instructorCourseMatch` is now a wrapper of it). Both are attached at the end
of the file, beside `Core.gate`, to keep merges clear of the modules they extend.

### 14.2 Changes during build

- **Token encoding (§4.4).** The claims are `canon` JSON in base64url; the mac is the HMAC written as
  64 hex (not base64url). Same strength, one encoding fewer.
- **`crypto.sha1Bytes` is plain SHA-1.** HMAC-SHA1 for two-step codes is built inside `Core.gate`, so a
  runtime only has to provide a digest (Apps Script: `Utilities.computeDigest`).
- **`publishDecision` has a fourth answer, `'keep'`:** equal stamps and the published copy has the higher
  hash. `'behind'` keeps its meaning (this device has seen less).
- **`maxStamp` (§3.3)** is computed once per pass over every record of every collection a slice draws on,
  plus deletion times and the accounts, ignoring stamps more than a day ahead (`Core.sync.trusted`). It
  is therefore the same for every slice one device builds at one moment: the strictest reading of "every
  record the builder examined", and the only one that also covers a result moved from one trainee to
  another.
- **The slice hash** covers `version`, `accountId`, `studentId`, `settings`, `data`, `tombstones` and
  `access` (settings and ids added, so a new gate address or a rename republishes). `builtAt`,
  `builtBy`, `maxStamp` and `inboxSeenUntil` are outside it. Every list in a slice is kept in a fixed
  order (by id; notices newest first; results by submission; the register by date), so two devices with
  the same records publish the same bytes.
- **Exam fields** use the names the exam records really have: `questionsPerPage` (not `perPage`),
  `allowFlag`, `instructions`, and `passRate` in slices. Draft and cancelled exams are left out of
  slices, papers and keys.
- **Chat in slices.** A slice lists the trainee's class and group rooms and their conversations with
  staff; each room's members are cut to the trainee and staff. A conversation with **another trainee is
  not listed**: its id (`dm-USR-a-USR-b`) names the other person. Serving those needs an opaque room id
  first (a Stage 4 decision). Messages are never in slices; they are in the room files.
- **Notices that name a trainee** (the dashboard's own "Certificate issued: …", "… submitted work for …",
  and the like) reach only the trainee they name; score and mark notices never reach trainees (as the bell
  already hid them). Text that staff write to all trainees is passed as written.
- **A last-line sweep.** After the per-collection rules, every slice is swept for any other trainee's id
  (also inside longer ids such as `USR-SYNC-STU-…`), name, email, password check, two-step secret or
  backup code, and for `correctAnswer`/`pairs`/`distractors`/`tolerance`. What it removes is counted in
  `scrubbed`; on the generated Centre it removes nothing. The publisher should log a non-zero count.
- **Slice tombstones** are the shared pools' deletions of the last 120 days (announcements, exams,
  calendar events, classes, assignments, resources, rooms — direct conversations only with staff —,
  notices, certificate templates) plus the trainee's own profile keys. A trainee-owned pool needs none on
  the device: the slice replaces it, and the collector's merge honours the Centre's deletions.
- **Who gets a slice:** an account that can sign in now (`accountAccess.check` allows it, or it has no
  password but an email to sign in with) and that links to a trainee record. Accounts that can sign in
  but link to nothing are returned as `unlinked` (the trainee sees "Your records are being prepared").
- **The slice's account card** also carries `studentDataId`, `createdAt`, `updatedAt` and
  `emailOtpLogin` (as a yes/no).
- **`validateItem` details.** A map record (a profile) names its key in `item.recId`. At the gate an
  attempt needs its paper (`opts.papers`), so question ids can be checked. A submission's `studentName`
  and a request's name and programme are taken from the slice. **A withdrawn request is
  `status: 'cancelled'`** — a value the office queue does not list yet (Stage 3/4 must show it). A
  support message already collected is acknowledged (`known: true`) and not taken twice. A chat message
  may not carry file bytes (`'inline-file'`: upload first) and keeps only its own fields. A profile's new
  name becomes `requestedName`. `backupCodeUsed` is accepted only from a gatekeeper-written inbox
  (`opts.lane`).
- **A spent backup code** is named in an inbox by `codeHash(code)` = `'h1-' + hashString('bc|' + CODE)`
  (not SHA-256), so a staff device can apply it without asynchronous crypto. The code is spent anyway.
- **`collect()`** (not in §11's list) is the collector's pure step. A file it cannot place is **not
  marked seen**, so it is collected again once an administrator has placed the trainee; the unassigned
  list is keyed by file. An inbox never carries a retired attempt (the gatekeeper writes those into result
  files), so one found in an inbox is refused. A file of a newer format is left unread and unmarked.
- **`markAttempt`.** Every question of the key counts (one missing from the trainee's copy counts,
  unanswered; one listed twice counts once). A question id the key does not have is ignored and listed in
  `result.ignoredQuestionIds` (§5.3 said "needs staff marking"; ignoring it means a made-up question can
  neither earn marks nor hold a result back). `submittedAt` is the gatekeeper's receipt time; the result
  also carries `receivedAt`, `markedAt` and `markedBy: 'gate'`.
- **The store namespace (§7.1).** The store also exposes `CESTISStore.namespace` (`''` or `'g1'`). With
  the switch off the store is unchanged, write for write, except that the main store now ignores
  `g<n>::` keys on load and in events — keys only a gate session ever writes. The master snapshot and the
  Centre network's mirror also refuse `g<n>::` keys. The inline copy in `index.html` is an older
  generation than the canonical one (no IndexedDB-only markers); the switch is identical in both, and the
  page loads the canonical copy first.
- **Device-only keys** (`Core.gate.DEVICE_KEYS`): `cestisGateNs`, `cestisGateMode`, `cestisGateToken`,
  `cestisGateSessionKey`, `cestisGateAddress`, `cestisDeviceKind`, `cestisGatePublished`,
  `cestisGatePublishQueue`, `cestisGateCollected`, `cestisGateUnassigned`, `cestisGateQuarantine` — in
  `DEVICE_ONLY_KEYS`, the page cloud's `DEVICE_KEYS` and its whole-store mirror's `exclude`.

### 14.3 For the builders of Stages 2–6

- **Stage 2 (gatekeeper).** Pass `crypto` from `Utilities` (`computeHmacSha256Signature`,
  `computeDigest` SHA-256 and SHA-1; convert signed bytes to 0–255). Run `selfTest` on `selfcheck`. Before
  `markAttempt`, merge the trainee's lanes and slice with `resumeAttempt` and pass `receivedAt` and
  `firstSeen`. Answer `review` with `redactResult(fillAnswers(result, key), key.exam, serverNow, key.centreUtcOffset)`
  (built: §14.4).
  Refuse items older than `ITEM_MAX_AGE_MS` by `sid.check(...).iat`.
- **Stage 3 (staff).** Pass the dashboard's `findSkillAreaForCourse` as `opts.findSkill` so slices match
  what the trainee portal shows; yield between `sliceFor` calls. Pass the fold log (`cestisFoldedAccounts`)
  as `opts.folds`, and keep the student-ID moves the stabiliser makes (`cestisStabilizeStudentIds`'s
  `res.idMap`, today thrown away) to pass as `opts.relinked` — without them a rename's later records reach
  the slice only when one of them names the trainee's account (§14.4). Feed `collect()`'s `payload.data` to
  `mergeBackupData` and `payload.records.voctrain_certTranscriptRequests` through
  `Core.Transcript.mergeRequestLists` (`mergeBackupData` reads every `data` name, `examAttempts`
  included since the exam-resume page work). Apply `ops` with `applyOps` and stamp
  `touchedAccounts`. Keep `unassigned` in `cestisGateUnassigned` by file id, and re-fetch those files
  (they fall behind the watermark). Log `scrubbed > 0`. The office request queue must show
  `cancelled`.
- **Stage 4 (trainee).** Shuffle papers with `Core.exams.attemptQuestionsFromPaper`, never
  `attemptQuestions`. Seal with `seal()` semantics (`HMAC(sessionKey, canon(item without mac))`, the key
  as UTF-8 of its hex) on WebCrypto. Use `sliceExamStatus` for slice exams. A trainee-to-trainee
  conversation is not in slices yet.
- **Release.** `index.html`'s `instructorCourseMatch` now needs the new `cestis-core.js`; bump the
  `?v=` stamp of `cestis-core.js` and `cestis-page-cloud.js` (and `sw.js`'s list) when this is merged.

### 14.4 Moved into `Core.gate` after Stages 2 and 6a

The two gatekeepers — the online one (`trainee-gate/Gate.gs`) and the Centre server's
(`Offline System/cestis-offline-gate.js`) — each carried their own copy of the rules they share, kept
equal by tests (Stage 6a marked its copy `TODO(core)`). They are `Core.gate`'s now, and both call them;
behaviour is unchanged, answer for answer (`tests/gate-contract.test.js` also checks that neither gate
defines a copy any more).

- **Sign-in:** `indexAccounts`, `lookupLogin`, `credentialRefusal`, `twoStep`, `ticketMake` /
  `ticketRead`, `sidRand` / `sidCv` (§14.1). Gate.gs's `gateBuildIndex` adds only its cache fields
  (`v`, `ledgerId`, `updated`); `gateTicketRead` adds only single use and the tries count. The Centre
  server's module no longer exports `rules`.
- **Lanes (online only):** `laneMerge`, `laneStamp`, `laneFirstSeen`, `firstSeenOf` replace Gate.gs's
  `gateLaneMerge`, `gateRecStamp`, `gateFirstSeen` and the earliest-first-seen loop in `gateSubmit`. The
  Centre server has no lanes (it merges into the records file) and keeps its own `gateFirstSeen` stamp
  on the attempt.
- The allowlist paste carries all of `Core.gate`, so nothing new is needed in it; the new rules touch only
  `Core.accountAccess`, `Core.accountLoginScore` and `Core.exams`, which it already carries.
- **`review` of a result that came only in the slice.** A test marked on a lab PC reaches the trainee's
  device only through their slice, and every result there is redacted. Gate.gs answered `review` from
  that copy: `revealed: true` and no right answers, where the Centre's server, holding the result whole,
  showed them. `fillAnswers(result, keyFile)` now puts them back from the key file before `redactResult`
  decides on the gatekeeper's clock; the Centre's server calls it too (a no-op on its whole copies, and the
  same repair for one stored without them). One difference remains by construction: if staff change a
  question's key after a result was marked, the online review shows the key as it is now, the Centre's
  server the one stored at marking.
- **Records under a former student ID reach the slice** (a gap Stage 6a found). A student ID is a hash of
  the name and the programme, so a rename or a transfer moves it; the dashboard relinks what it holds at
  that moment, but a result marked since on a lab PC that still knew the old ID, an assignment's grade
  maps (no relink carries them) and a duplicate's records once the fee roll's stub is folded stayed under
  the old ID, and `sliceFor` (by student ID alone) left them out. `prepare` now works out each trainee's
  former IDs (`formerIdsOf`) from what the records say: a stub folded into their account (the fold log
  or `backfillStubFolds`; the stub's own copy, deleted or not, or the ID a `USR-SYNC-…`/`USR-STU-…` id is
  made of); the dashboard's own identity rule (`Core.migrateToStableIds` on a copy of the roll: a
  duplicate, or the ID their record is about to move to); a move the caller kept (`opts.relinked`); a
  record of theirs naming their account under another ID. **The privacy back-check:** never another
  trainee's current ID, never a record another account links to, never a deleted trainee's ID, never a
  record pinned "keep separate"; a live record only on the identity rule or a kept move (never a fold or an
  account alone); an ID two trainees could claim goes to neither (`ctx.formerUnsure`). Those records come
  into the slice re-owned to today's ID (`reown`), as do support messages, the assignment's grade, grade
  history and feedback, and a transcript header or profile where today's ID has none. A Centre with none of
  this builds the same slices as before, byte for byte (`tests/gate-slice.test.js`, which also covers a
  rename, three kinds of fold and six near misses). Stage 1's last-line sweep still takes out of a slice
  any record naming another trainee's account (a result staff moved from one trainee to another keeps the
  first one's `accountId`, so it leaves the second one's slice too): left as it is, for Stage 3/4 to decide.

---

## 15. Stage 3 as built — the staff side (publish, collect, the card)

All in `index.html` (one block after `autoSaveToAllFolders`, the card's functions beside it), the
Settings fragment `Pages/Administration.html`, the request queue `Cert-Transcript-Requests.html`, and the
broker's `OWN_FILES`. Tests: `tests/gate-publisher.test.js` (Node: the real page functions, one sandbox per
"computer", all writing through `gateDriveApi`'s fetch to one `tests/browser/fake-drive.js`) and
`tests/browser/gate-staff.js` (`npm run test:browser:gate-staff`).

### 15.1 When it runs, and when it does not

- `autoSaveToAllFolders` calls `gateStaffTick()` after a pull `pullAllowsUpload()` accepts, before the
  "nothing new" shortcut, inside a `try` (nothing the gate does can stop the save). Its first act is
  `gateStaffOn()`: `systemSettings.traineeGate.enabled === true` with an address, a staff role (admin,
  admin staff, instructor), the Centre's sign-in, not wiped, not a gate namespace, not killed. Off ⇒ it
  returns: no request, nothing written (pinned in both suites, with a request counter `_gateRun.drive`).
  The one exception is an administrator's own **Turn off / Turn on** that could not reach the gate yet
  (§15.5): retried beside the next saves until done, then nothing more.
- `gatePublishTick()` and, at most once a minute, `gateCollectTick()` run on their own (not awaited), one
  tab per PC (`navigator.locks`, `ifAvailable`). The administrator's PC also checks the address once a
  day while the gate is on.
- The site kill switch: a `gate-off` file next to `index.html` (like `sw-disable`) is looked for once a
  page load, only when the gate is on; present ⇒ the staff side idles.

### 15.2 Publish

- **Where:** `CESTIS_GATE.json` beside the accounts list (the main folder; by name anywhere only when the
  main folder has none); of several, the oldest (the gate's own rule). Re-read every 6 hours and after
  every Check.
- **What is published** is noted in `cestisGatePublished`:
  `{v:1, device:'dev-…', files:{path:{id,h,s,parent,created,modified}}, folders:{acct:{id,name,created}},
  dups:{id:{kind,acct|path,of,name,marked}}, remoteAt, inventoryAt, syncedAt, health}` with paths
  `key:<examId>`, `paper:<examId>`, `slice:<acct>`, `room:<roomId>`. It is refreshed by **one listing**,
  `appProperties has { key='cestisGate' and value='1' } and trashed = false` (+ `modifiedTime >` the last
  look − 10 min), on the first turn of every page load and every 5 minutes after; the whole listing once
  a day, or after a write found its file gone (404).
- **Every file the publisher writes** carries `appProperties {cestisGate:'1', cestisKind, acct|examId|roomId,
  h, s}` — folders too (`cestisKind:'folder', acct`), besides their description `cestis-trainee acct=… v=1`.
  Names: `from-centre.json` (in the trainee's folder, named with their student ID), `key.<examId>.json`,
  `paper.<examId>.json`, `room.<roomId>.json`.
- **Build:** `gateBuild` = `prepare` + `sliceFor` per trainee with a `MessageChannel` pause every 25 (timers
  are slowed in a background tab), then `buildPaper`/`buildKey` for every exam in someone's
  `access.papers` and `buildRoom` for every room in someone's `access.rooms` (members: the room's own,
  not removed, plus the trainees whose slice lists it) — the same hashes as `buildAll` (tested). The store
  map is `GATE_STORE_KEYS` read through `CESTISStore` (tested to cover every key `Core.gate` reads).
  `opts`: `findSkill: findSkillAreaForCourse`, `folds: cestisFoldedAccounts`, `builtBy`, `gateUrl`,
  `inboxSeenUntil` (§15.3). It builds when the store's write count moved or the pull changed something
  — **at most once a minute** — and at least every 10 minutes. `scrubbed > 0` is logged.
- **Plan** (`gatePlan`, pure): keys → papers → (folder create / rename) + slices → rooms → duplicate marks,
  each decided by `publishDecision` against the listing. A folder is made or renamed only alongside a
  slice decision of `write` or `skip`, so a PC that is `behind` never renames a folder back.
- **Write** (`gateRunQueue`): ≤ 120 a turn, ≥ 500 ms apart; update = `PATCH …/upload…?uploadType=multipart`
  (content + `appProperties` in one write); create = multipart `POST`; folder = `POST files`; rename and
  marks = metadata `PATCH`. 401/403/429/5xx or no connection stop the turn; a 404 forgets the file and
  makes the next look a full one.
- **Duplicates:** oldest `createdTime` to the millisecond, then the lower id (`gateOlder`, the gate's rule).
  A younger folder gets ` duplicate-of=<id>` added to its description and `cestisGate:'dup'`; a younger
  file of the same path is renamed `duplicate-of-<id>.<name>` with `cestisGate:'dup'`. Nothing is ever
  deleted or binned; a younger folder's inbox files are still collected (the `dups` map, or the folder's
  own description).
- **`cestisGatePublishQueue`** holds the last turn's plan (op, path, kind, h, s — never content): the
  card's "N waiting". Each turn rebuilds the plan from the build and the listing, so a reloaded tab
  writes only what is still missing; the notes are saved after every write, and the first listing after
  a reload catches a write whose note was lost (tested: nothing written twice, nothing doubled).
- **This PC's notes** (`cestisGatePublished`, `…Queue`, `cestisGateCollected`, `cestisGateUnassigned`)
  are written straight to `localStorage` (read through `CESTISStore`, which reads it first), so they
  never count as a change to the Centre's records and never wake the 5-second save.

### 15.3 Collect

- One listing: `name contains 'CESTISINBOX' and trashed = false` (+ `modifiedTime >` mark − 10 min),
  `orderBy=modifiedTime`, `pageSize=500`; only names starting `CESTISINBOX.` (lanes and result files);
  files already read at this `version` are skipped. Files waiting for a decision, and files of a newer
  format, are looked at again by id every 10 minutes (the mark has passed them).
- Owner: the parent folder — a known trainee folder or duplicate, else its metadata (it must sit in
  `Trainees/` and its description must start `cestis-trainee `). The gate's own folder (`_gate`, with its
  live checks `CESTISSMOKE.name-check.json` and `smoke-description-check/`) and the root are never read.
  A stray inbox file outside the trainees' folders is noted as read and ignored.
- `Core.gate.collect` → `mergeBackupData({version:'1.0', data})`; `_mergeBackupFailed` ⇒ nothing is
  noted and the mark stays (tested). Requests → `Core.Transcript.mergeRequestLists` into
  `voctrain_certTranscriptRequests`. Ops → `Core.gate.applyOps` on the page's own arrays, then
  `touchAccount` + `saveUserAccounts` for a spent backup code, `saveNotifications`, `saveState`.
- `cestisGateCollected = {watermark, seen:{fileId:version}, byAcct:{acct:iso}, held:{fileId}, at}`;
  `cestisGateUnassigned = {fileId:{file, accountId, studentId, reason, items, since}}`.
- **`inboxSeenUntil`** in every slice = the collector's mark − 10 minutes (for every trainee account; `''`
  until anything is collected), so the gate's pull reads only the inbox files since. It is outside the
  slice hash, so a moving mark does not republish slices; a stale value only makes the gate read a few
  more files, never fewer.

### 15.4 The card (Settings → "Trainee Sign-in from Anywhere", administrator)

Status line (`gateStatusText`): **Not set up** · **Ready — version N · M trainee accounts** (+ "A newer
version is available" when the gate is older than `GATE_EXPECTED_VERSION`) · **Needs attention: …** (not
checked yet; no answer; not the trainee sign-in; not finished; accounts list not found; the page is older
than the gate; records could not be sent just now). The last check is kept in
`cestisGatePublished.health`. Steps: *Copy the setup code* (fetches `trainee-gate/PASTE-GATE.gs`; "The setup
code isn't available yet." when the site does not serve it), *Setup sheet* (`trainee-gate/SETUP.md`),
*Address* + *Check* (saves the address in `systemSettings.traineeGate`, still off, then `?op=health`),
*Turn on / Turn off* (Turn on needs a passing check of that address). When on: the trainees' sign-in link
`<site>/index.html#gate=<base64url(address)>` — the site is "Public address of this site"
(`certVerifyUrl`) when set, else this page's address — its QR code (the bundled `qrcode.js`, via
`certMakeQrCanvas`), *Copy link*, *Print* (a page with the code, "Sign in on your own phone: scan this
code." and the link). "Records sent to trainees: N min ago (K waiting)" and "Trainee work waiting for a
decision: N" with whose and why. The office request queue shows a withdrawn request (`cancelled`) as
"Withdrawn by the trainee", in its filter and its status menu.

### 15.5 Changes during build

- **Turn off / Turn on also tell the gate** (Stage 2's contract): Turn off writes `gate-off` in the gate's
  folder (it stops answering trainees within a minute); Turn on bins it. Retried beside the next saves
  when it cannot be done at once.
- **The remote check lists every gate file** (`cestisGate='1'`, folders included), not only slices, so
  keys, papers, rooms and folders made by another PC are seen in the same one query; and it runs on the
  first turn after every page load (otherwise a reloaded PC could make a second copy of what it had just
  written).
- **Duplicate files**, not only folders, are settled by the same oldest rule (renamed, never deleted).
- **The persisted queue holds references, not content** (300 slices would not fit in `localStorage`);
  content is rebuilt on the first turn.
- **Builds are at most one a minute** while records keep changing (an office typing would otherwise
  rebuild every 5 s).
- **`inboxSeenUntil`** is the collector's mark less its overlap, for every trainee, not each trainee's own
  newest collected file (§15.3).
- **A tie on the newest moment** (`publishDecision`'s `'keep'`) can hold an older copy when records change
  without a newer stamp (a record learnt late with an old stamp; a deletion older than 120 days dropping
  out). It settles at the next stamped edit and never ping-pongs (tested).
- **Transcript requests** collected on a staff PC are in that PC's store at once and in the office queue
  there; they reach the shared requests file when the Requests or Transcript/Grades page next syncs on a
  staff PC (the dashboard itself has no page-cloud push for that key).

### 15.6 Measured (headless Chromium on the build machine)

Six trainees: from *Turn on* to everything sent, ~11 s. **300 generated trainees** (5 programmes, two
exams): the build 0.1–0.3 s, the longest stretch without a pause ~30 ms; 609 writes in all (300 folders,
300 records, 2 papers, 2 keys, 5 rooms) = 6 turns; the first turn 61 s for 120 writes at the real
2-a-second pace, so about 5–6 minutes for a whole first publish; afterwards a turn with nothing new is a
~0.1 s build and no write. An old office PC will build several times slower; the pauses keep it usable.

### 15.7 For Stage 4

- The browser suite's `fakeGate` only answers `health` and sets up folders and `CESTIS_GATE.json`; Stage 4's
  fake-gate (the real `PASTE-GATE.gs` in `vm` over the same `FakeDrive`) can reuse `tests/browser/gate-staff.js`'s
  `computer()` / `adminSignedIn()` to have a staff PC publish first. `FakeDrive` now models `appProperties`,
  descriptions, `modifiedTime` filters, `multipart/related` uploads and an optional clock.
- The trainee link is `index.html#gate=<base64url(address)>` (`Core.gate.b64url(Core.gate.utf8(url))`); the
  trainee side parses it into `cestisGateAddress`. The `gate-off` file next to `index.html` is checked
  here for the staff side only.
- Requests a trainee withdraws arrive as `status:'cancelled'` and are shown; the delay in §15.5 (last
  point) applies to them as to any request made on a staff PC.

## 16. Stage 4 as built — the trainee side

The owner, during the build: *there is no lab computer at the moment — trainees sign in at home and
sit their assessments there.* Signing in and sitting tests from home through the gate is therefore
the main path; the lab-PC fallback (§16.6) is secondary.

`cestis-gate-client.js` (new, `window.CESTISGate`, loaded `defer` by `index.html`, precached by
`sw.js` through its script tag), the trainee block of `index.html` (after the staff block), small
guards elsewhere in `index.html`, `cestis-page-cloud.js` (inert in a gate session) and one additive
line in `Core.gate` (§16.5). Tests: `tests/gate-client.test.js` (Node, in `npm test`, against the
real `PASTE-GATE.gs` in the simulated Apps Script runtime) and `tests/browser/gate-flows.js`
(`npm run test:browser:gate`, the real `PASTE-GATE.gs` in `vm` over the same `FakeDrive` the staff PC
writes through, plus the Offline System's own server for §16.7). With the gate off, nothing of this
runs: no request, no new storage (`hasWork()` asks `indexedDB.databases()` without opening anything).

### 16.1 Which gate, and the trainee card

- `CESTISGate.base()`: on the Centre's own server (`CESTISPageCloud.lan()` and `GET /_cestis/gate`
  answering `cestis-trainee-gate`) its `/_cestis/gate`, when its records are for staff only or the
  settings turned the gate on; else the address from the trainees' link (`#gate=…`, https only, kept
  in the device-only `cestisGateAddress` and taken out of the address bar); else
  `systemSettings.traineeGate` when enabled. The `gate-off` file next to the page wins over all of
  them, and a gate answering `off` gives today's sign-in.
- The card (`gateTraineeDecide`, once a page load): usable without Sync Now; on a device holding none
  of the Centre's records (`gate-trainee-only`) "Sync before signing in" is hidden; on the Centre's
  network the email-account button is hidden (as are emailed codes, upload and `file.get`).
- Sign-in: the PBKDF2 (or older) proof is worked out on the device with the page's own hashing; the
  email account by its token (`auth.email`); two-step in its own dialog (authenticator, backup code,
  an emailed code online only). "Signing in…", then — after `enter()` and the reload into the
  namespace — "Getting your records…" the first time. Refusals use §9's words; `pending` opens today's
  "Awaiting Approval" screen (without the programme/registration line, which the gate does not give).

### 16.2 The namespace, and what the device keeps

- `enter(session)` drops another account's namespace first (and refuses if it cannot), writes the
  session into `g1::` keys and `cestisGateNs = g1`, re-seals that same trainee's revoked outbox
  entries, and the page reloads into `CESTIS_KV__g1` / `g1::`.
- `pull` (with the slice hash) and `applyPull`: read-only keys replaced; the trainee's own lists and
  maps merged with what the device has not sent yet (`planApply`; base hashes in `cestisGateBase`), a
  retired attempt winning, results the gate marked kept. `gateReloadMemory()` reads the accounts,
  records, notices, support messages and chat back into the page.
- In a gate session: no 5-second save, no Sync Now, no page-cloud pull or push (`cestis-page-cloud.js`
  does nothing, on the Centre's network too), and no built-in login is seeded — not in the namespace
  and not on a phone opened from the link. Dumps of each phone's storage hold no other trainee, no
  password check, no two-step secret or backup code and no answer key (gate-flows §3 and §9).

### 16.3 Sending: the watcher and the outbox

- The watcher (`capture`, on every store write to a watched key, every 15 s while visible, on
  visibility and `online`) diffs the trainee's own records against the base: an open attempt, a
  submission, a request, a support message, the profile, own chat messages; read and cleared marks as
  operations; never another trainee's record, a retired attempt or a picture's bytes.
- Items are sealed (`HMAC(sessionKey, Core.gate.canon(item))`, WebCrypto) into `CESTIS_GATE_OUTBOX`
  (IndexedDB, outside both namespaces). A newer unsent save of a record replaces the waiting one —
  never a refused one, another trainee's or a submit. Delivery: one tab at a time (Web Lock
  `cestis-gate-lane`), batches of 50, backoff 2 s → 5 min. Receipts: done → removed; `revoked` → kept
  and sealed again at that trainee's next sign-in; `retry` → sent again; anything else stays, marked
  refused, with why.
- The top bar chip in a gate session: "Saved here — will be sent when you're back online (N waiting)".

### 16.4 Tests through the gate

- My Exams uses `Core.gate.sliceExamStatus` on the gate's clock (`serverTime` and the Centre's
  offset). The paper is fetched once, online (`paper`, kept as `cestisGatePaper__<id>`); the attempt
  is built with `Core.exams.attemptQuestionsFromPaper` and then runs offline. The deadline comes from
  `paper.exam` + `centreUtcOffset` + `serverTime`, mapped onto the device clock at the start.
  A second device continues the same attempt (`attempt.get`) with the same deadline.
- Saves are sealed items; Submit queues a `submit` item and shows the gate's result at once when
  online. Offline: "Your test is submitted here and will be sent to the office when you're back
  online.", "Submitted — waiting to send" in My Exams, the attempt retired on the device. Review
  through `review` (the right answers only once released, on the gate's clock).
- The attempt's activity log (`Core.exams` activity: start/resume and device, pages and questions
  reached and answered, the window left and come back to, the connection lost and back, the
  submission — never an answer) is kept on the device exactly as on any other; a submission through
  the gate notes how it was submitted and keeps the log in the retired record.

### 16.5 The activity log end to end, and the invigilator board

- `Core.gate.validateItem` (so the gate, its lanes and the staff collector, which checks lanes again)
  keeps an attempt's `activity` as `Core.exams.activityOf`'s clean copy (additive, in `normAttempt`).
  The lane merge, the gate's marking (`retireAttempt`) and the collector already merge and keep it.
- The Exam Invigilator board on a staff PC collects what trainees sent every 20 s while it is open
  (`gateCollectForBoard`, `INVIG_GATE_MS`) and at once on "Check now"; "last checked" is the last
  collection, never "just now" when nothing was collected; each row says how old its copy is.
- gate-flows §11: a trainee at home starts a test while the office has the board open; the board
  shows him in progress on his page and question, "Left the test window 1×", and his timeline; then
  "Submitted … by the trainee" and the whole timeline.

### 16.6 Coursework, chat and the rest; sign-out; the lab PC

- Coursework: each file through `upload` first (the allowed kinds, 5 MB), the submission naming it;
  files opened through `file.get`. On the Centre's network, small files (≤ 350 KB in all) travel
  inside the submission as they do there today; larger: "hand your work to your instructor".
- Chat: the class rooms' history from `room.get` (every 45 s on the chat page, 2½ minutes elsewhere);
  her messages sealed. Pictures are not sent through the gate (their bytes are stripped); trainee ↔
  trainee direct messages are not in slices.
- Notices read, profile edits, certificate/transcript requests (the embedded Transcript / Grades page
  works in the same namespace), support messages: all sealed and collected as hers.
- Sign-out: sends what it can; the session's token and key go at once; the namespace goes once
  nothing of hers waits, otherwise it stays and the next load (signed in or not) sends it and then
  clears it.
- A device holding the Centre's records (a lab PC) may fall back to today's sign-in when the gate
  cannot be reached (not with `traineeGate.strict`); its own storage is left byte for byte by a gate
  session. A trainee's own device never falls back.

### 16.7 The Centre's own server

The same client against `/_cestis/gate` with "records for staff only" on: password sign-in, the
test, exactly one result in the Centre's records, the phone given neither the records token nor any
records file (gate-flows §9).

### 16.8 Changes and deviations during build

- Deadlines run on the device clock, mapped from the gate's `serverTime` at the start (the device's
  own clock is never trusted for when the test opens or closes).
- The support form stays on the sign-in page; in a gate session a message is sealed as hers.
- The review keeps today's wording ("Correct answers will be shown here once the exam has closed.").
  With no key on the device, a single choice is ticked or crossed by the question's own result.
- On the Centre's network with staff-only on, a device that is not signed in as staff still shows
  the page cloud's "Not synced … Reload this page" notice on the sign-in page (its pulls are refused
  — today's Stage 6a behaviour), and its own storage gets today's three built-in first-run logins
  (published defaults); nothing of the Centre's. Left for Stage 6.
- The shared-computer mode (`sessionStorage` token) and `cestisDeviceKind` are not set here: Stage 5.

### 16.9 For Stage 5

- A namespace is kept while anything of that trainee waits; `CESTISGate.tidy()` (main namespace) clears
  one left with nothing to send. `Core.gate.cleanupPlan` is not wired yet; `upgrade-no-data-loss.js`
  passes unchanged.
- `gateDeviceHoldsCentre()` reads `cestisDeviceKind === 'staff'` when Stage 5 sets it; until then it
  looks for any account beyond the three built-in logins.

## 17. Registration from home, and trainee accounts made in the office (as built)

The owner decided (October 2026): *"Both the office admin staff and administrators can create account
for students, while trainees register the account at home, for office approval (on registering a folder
by trainee name should be generated same time and uploaded to drive, trainees must use a google account
for authentication in order for account to reach system."* There are no lab PCs at the Centre now:
trainees sign in and sit tests at home through the gate.

**The gate was version 2 here** (`GATE_VERSION`, and `GATE_EXPECTED_VERSION` in `index.html`; version 3: §18): the
administrator pastes `PASTE-GATE.gs` again (SETUP.md §2). Until then the card says "A newer version is
available", sign-in works as before, and registering answers "Registration is not open just now". The
Centre's server's gate is version 2 as well (it answers the new requests `not-available`).

### 17.1 Office creation (administrators and Admin Staff)

- **One rule** for a new account, `Core.accountAccess.officeCreateRefusal(actor, draft, accounts,
  {enrolBlock})`: an administrator may create any role; **Admin Staff trainee accounts only** (never
  admin, admin staff, instructor or board), and only while *Trainee Accounts* is ticked; a full name
  (`isFullName`, equal to Staff Appraisals' `sappIsFullName`, tested); no markup; a username nobody holds
  in any case; for a trainee, an email nobody holds in any case (any role; blank allowed) and a programme
  taking trainees now (`courseEnrolmentBlockReason`); a phone (`PHONE_RE`). Settings → Users' *Create
  User* now goes through it too.
- **"+ Add Trainee Account"** (`createTraineeAccount`, on Verify Users — so on Admin Staff's *Trainee
  Accounts* page too): an **active** trainee account (the office has seen the trainee), `registeredVia
  'admin-created'`, `createdBy` / `createdByRole`, `approvedAt` / `approvedBy` (the role, as the field
  always held) / `approvedByName` (the person); the trainee record linked or made; the accounts list
  written at once; then `gatePublishSoon()`: with the gate on, the publishing turn runs **now** and
  builds at once (`_gateRun.buildNow`; a turn already running is followed by another), so the trainee's
  folder `"<Name> (<student ID>)"` and records appear in seconds (measured in the browser suite: 1–2 s).
  With the gate off: nothing (the first turn after *Turn on* makes it).
- **Admin Staff access:** a new key `traineeaccounts`, **on by default** (the owner said they can), in
  the Administrator's grid ("Trainee Accounts — trainees only") so it can be switched off. It opens the
  page `as-trainee-accounts` (the Verify Users fragment) and lets Admin Staff approve or reject
  **trainees'** registrations only (`accountReviewAllowed`: never a staff role, never a registration
  asking for one). Every approval or rejection now records who (`approvedByName`).

### 17.2 Registering from home, through the gate

```
phone (link #gate=…)                               gate (as the Centre's account)            shared files
"New trainee? Register with your email account"
  initTokenClient (userinfo.email + profile, as email sign-in)
  ── register.start {accessToken} ───────────────▶ tokeninfo: aud = the dashboard's client,
                                                    email_verified, not expired, email scope
                                                    (gateEmailToken — email sign-in's own check)
                                                    address has a trainee account? → has-account |
                                                      pending | rejected | disabled
                                                    CESTISREG.<id>.json exists? → submitted
                                                    no catalogue → not-open
  ◀─ {state:'new', email, programmes} ────────────
  form: full name (from the account, editable), programme, phone?, password ×2, and her details:
        gender, date of birth, TRN?, address, parent/guardian?, emergency contact (group A, OF-3)
  password → pbkdf2$210000$<fresh salt>$<hash> on the device (hashPassword); never sent as typed
  ── register.submit {accessToken, name, programme, phone, password, gender, dob, trn?, address, …} ─▶ same checks; reg.check(form, catalogue)
                                                    limits (5/h per address, 60/h, 200/6h overall)
                                                    script lock (10 s), then, in ONE request:
                                                     Trainees/"<Name> (<student ID>)"  desc "cestis-trainee acct=<id> v=1 registration=pending"
                                                     Registrations/CESTISREG.<id>.json (folderId, folderName)
  ◀─ {state:'submitted', email, programme, submittedAt}
  pending screen 'sent': "Your registration has reached the office…"
```

- **One registration per address.** The account id is `USR-home-` + `HMAC(GK_SECRET, 'reg|' +
  lower(email))[0..20]` (`Core.gate.reg.accountId`): the same Google account, from any device, in any
  case, always gets the same id, file and folder. A re-submit returns `{state:'submitted', already:true}`
  and changes nothing. If the folder was made but the file's write failed, the next try finds the folder
  (`fold:<id>` Script Property, set at once) and writes the file: never a second folder.
- **The student ID** in the folder's name is the dashboard's own (`Core.gate.reg.studentId` =
  `Core.stableStudentId({name, course: programme})`); the paste now carries `Core.naturalKey`,
  `Core.stableStudentId`, `Core.programmeIdentity` and `Core.enrolment` for it (allowlist ~363 KB).
- **No other way from home:** with the gate on, the trainee card hides today's "Register here";
  `openRegistrationModal('student')` goes to `gateRegisterStart()`; an email sign-in that finds no
  account goes straight on to the form with the same token. Today's form stays for the instructors' card
  and for a lab PC that falls back to today's sign-in.
- **The catalogue** (`catalogue`, no sign-in; remembered a minute): `Registrations/catalogue.json`,
  written by the staff publisher (`Core.gate.reg.buildCatalogue`) from `officeEnrollingProgrammes()` —
  the same list "+ Add Trainee Account" offers. Its moment is at least the start of today, so a
  programme that ends tonight is withdrawn by tomorrow's first turn.
- **The Centre's own network** (`Offline System/cestis-offline-gate.js`): `catalogue`, `register.start`,
  `register.submit` → `not-available`; the client answers `not-available` there without asking; the card
  shows "New trainee? Ask the office to create your account."

### 17.3 Folder naming everywhere

`Core.gate.folderName(name, stu)` → `"Tameka Richards (STU-3wfiayryzq)"` (whitespace tidied, no slashes
or control characters, the name cut at 100 characters, the ID kept). `folderDescription(acct, mark)` →
`cestis-trainee acct=<id> v=1` plus ` registration=pending|rejected`. The publisher names every folder so
(the trainee record's name and ID from the slice), renames folders still named with the ID alone (one
metadata PATCH each, once), and keeps name and description in step (`rename` now also writes the
description). Folders are still **found by the account in the description**; oldest-wins is unchanged;
nothing is deleted or binned. The gate's own lookup (`gateTraineeFolder`) keeps its exact-name fallback
for folders not renamed yet, then the description search, and remembers what it found.

### 17.4 The staff side

- **Collector** (`gateCollectRegistrations`, at the start of every collecting turn, independent of the
  inboxes): one query `name contains 'CESTISREG' and '<registrationsId>' in parents and trashed = false
  [and modifiedTime > mark − 10 min]`, its own watermark in `cestisGateCollected.reg`, each file read once
  per version. `Core.gate.reg.importOne` → `add` (a `pending` trainee account: `registeredVia
  'home-registration'`, `googleVerified: true`, the gate's id, `gateFolderId`, phone, the password check,
  a username from the address, `createdAt` the local day, `updatedAt` the registration's moment) |
  `have` (the office's copy stands — a later edit of the file never overwrites it) | `skip` (deleted by
  the office; an address another account has) | `hold` (a newer format: not marked, read again). Added
  through `mergeCloudAccounts` (the one account rule), the accounts list written at once (so the gate
  answers "awaiting approval"), one notice for the office per registration (its id is the account's, so
  two PCs collecting it make one).
- **Verify Users:** "Registered from home · email account verified", the phone under the address, and
  the "may be a second account" warning when `accountForTrainee` finds another account of the person.
  Approving works as before (the record is made — its ID is the folder's — and `gatePublishSoon()`).
- **Publisher:** for an account carrying `gateFolderId` and no folder known yet, `adopt` instead of
  `folder`: the folder is checked (in `Trainees/`, not binned, its description naming the account),
  given the publisher's `appProperties` (so every PC's listing sees it), its name and description; if the
  check fails (moved, binned) the PC notes `adoptFailed` and makes a folder of its own next turn (the gate
  finds that by its description). While the account waits or was turned down (`regFolders`), the folder
  keeps the matching mark; once approved, the slice is written into it and the mark goes.
- **Duplicate-account protections:** a home registration is never a backfill stub (it has an email and a
  password); a fee-roll stub of the same person folds **into** it (`backfillStubFolds`), so no backfill
  makes a second account beside it (`traineeHasAccount`); `reviewQueue` lists it; a home registration
  asking for any role but trainee is a "privileged self-registration" (never one click).

### 17.5 Tests

`tests/home-registration.test.js` (rules in both builds, the duplicate protections, the client against
the real paste: the password leaves only as its check, a fresh salt each time; LAN not-available without
a request; the screen words), `tests/office-trainee-accounts.test.js` (the office rule in both builds, the
real page code: Admin Staff create trainees only, admins any role, active at once, who made it, publish
at once; review permissions), `tests/gate-appsscript-vm.test.js` §register (good token, wrong aud,
unverified, unknown, existing / pending / rejected address, catalogue, form checks, the registration AND
the folder in one request, re-submit idempotent from two tokens, a half-failed write finished with the
same folder, both limits, then approval and sign-in by email and by password — on both paste modes),
`tests/gate-publisher.test.js` (collect once, adopt, marks, catalogue, rename of old names,
publish-soon), `tests/gate-lan.test.js` / `tests/gate-contract.test.js` (not-available; version 2 on
both), and in browsers `tests/browser/home-registration.js` (`npm run test:browser:home-registration`):
Admin Staff create a trainee in the office (her folder in 1–2 s, she signs in at home); a trainee
registers at home (her registration and folder made together), the office collects, Verify Users shows
it, the administrator approves, she signs in with her email account and then her password.

### 17.6 Decisions and limits

- **Wording.** The owner's rule forbids naming where records are kept; `tools/scan-ui-wording.js` flags
  the word "Google" anywhere on screen. The button therefore says "Register with your email account" and
  Verify Users "email account verified", the words the platform already uses for the same sign-in ("Sign
  in with your email account"). Google's own window names itself. If the owner wants the word on the
  button, it needs a narrow, deliberate exception in the scanner (e.g. the phrase "your Google account")
  — not added.
- **Admin Staff approve trainees' registrations** (under the same tick as creating trainee accounts): the
  owner named the office admin staff as part of "the office" that approves. Instructor registrations
  and anything else stay with administrators.
- **No password at the gate in plain text, ever:** the device sends the stored-format check; the gate
  checks only its shape (PBKDF2, 100 000–1 000 000 rounds, 16-byte salt). The device enforces the
  strength rule (6+ characters, a capital letter and a number), as today's form does.
- **A registration file is never changed by the gate** once written (a re-submit with other details
  changes nothing); the office corrects details in Settings → Users after approving.
- **Not built:** registering for a programme not in the catalogue; an instructor registering from home.
  (Emailing the trainee when she is approved was built in version 3 — §18.5.)

## 18. Home study (version 3, as built)

The owner's group C, "Make home study smooth". **The gate is version 3** (`GATE_VERSION`, and
`GATE_EXPECTED_VERSION` in `index.html`); a version 2 gate keeps working — every new request answers
`unknown-op` there and the page says so plainly (fees: "ask the office"; password: "ask the office to
change it"; files: sent whole, as before; certificate: "Collect your certificate at the Centre").

### 18.1 Her fees (OF-12)

- One small file per trainee, `from-centre-fees.json` in her own folder (`Core.gate.home.buildFees`):
  her programme fee, her receipts (id, receipt number, date, amount, method, term) — never the office's
  notes, contact details or another trainee. Paid, balance and status are added up from her receipts.
- Only an office computer that holds the fee roll publishes it (a computer without it publishes
  nothing, so it never replaces a real file with an empty one). Two computers that know different
  things: `feesDecision` — the one that knows more deleted payments writes (a deletion never comes back),
  then the newer stamp on the whole roll, then the higher hash; one that knows less is "behind".
- `op: fees` (`{have}` → `{same}` / `{none}` / `{fees, h, builtAt}`); the device keeps the last answer
  (`cestisGateFees` in the namespace) for when there is no signal. The Offline System gate builds hers
  from its own fee roll on request. Page: My Fees (`s-fees`).

### 18.2 Her password, changed at home (OF-12)

- `password.start` → a challenge for HER account (login `acct:<id>`, the sign-in's PBKDF2 proof, its
  limits: 5 wrong → 15 minutes); `password.change {nonce, proof, password}` with the new password in the
  dashboard's stored form (never in plain text; shape checked by `storedPasswordOk`); at most 5 changes in
  6 hours.
- The gate keeps the change (`PW_PENDING`) until the accounts list shows it: sign-in uses it at once,
  every other session of hers ends (a new credential version), and this device gets a new session in the
  answer (what it had waiting is sealed again under it).
- The change reaches the office as an operation only the gate writes (`CESTISINBOX.L-pw-<session>`,
  `passwordChange {password, was, at}`); the staff collector applies it only if the account still holds
  the password she replaced (`was` = fingerprint) — an office reset since wins — stamped
  `max(updatedAt + 1, at)` so record-level newest-wins keeps it. If the accounts list is rewritten without
  it, the gate writes the note again. The Offline System gate writes the account itself.
- Page: Change Password in her account menu (gate sessions only).

### 18.3 Her certificate at home (T4)

- `cert.template {key, page}`: the background picture the office uploaded
  (`cert_template_<key>_<page>.txt`), only when her own records say the certificate is issued, not
  withdrawn, and its download approved, and only her programme's template. The device keeps it
  (IndexedDB) for the next time.
- The download is counted through her outbox: `certDownload {device, n, certNo}` (n = this device's
  running count, kept under a "Session" key); validated against her slice; the collector keeps the
  highest n per `home-<device>` (`recordHomeDownload`). On the Centre's own network, and whenever it
  cannot be downloaded, the button says "Collect your certificate at the Centre".

### 18.4 Her files, never lost (T2)

- A photo is made about 0.4 MB on the phone (`Core.homeStudy.photoPlan`: 1600 px on the long side, JPEG
  0.8 → 0.5, about 450 KB); one the browser cannot read (HEIC on most Android phones) is sent as it is.
- From home the files are kept on the device (IndexedDB `CESTIS_GATE_OUTBOX` version 2, store
  `uploads` — additive) and sent in parts of 384 KB (`upload.part {uploadId, index, total, size, …}`),
  each confirmed; the last part makes the file (same kinds, limits and daily allowance as `upload`); a
  part sent twice answers the same; parts left over go after 3 days. No `xhr.upload.onprogress` (it
  needs a CORS preflight the gate cannot answer): progress is counted in parts.
- A part that does not go: tried again later (2 s → 5 min; the day's allowance: an hour), on `online`,
  on coming back to the page, at her next sign-in on that device. A file the gate can never take is kept,
  marked, until she removes it. Only when every file is in is her submission written into her records,
  then sealed and sent like any other change of hers.

### 18.5 The approval email (T6)

- When the gate reads the accounts list, every account that registered from home and was approved in
  the last 14 days, not yet emailed, goes on a short list (`MAIL_QUEUE`); `health` sends up to 5 at a
  time (`MailApp`, the Centre's own account — about 100 a day on a free account; no new set-up; EmailJS
  was not used: its template carries only a sign-in code and its 200 a month are shared with those
  codes). Each trainee is emailed once (`MAILED`, kept 30 days). Activate / Approve All ask for `health`
  a few times (20 s, 1, 2 and 5 minutes on) so it goes out soon.
- The pending screen says "The office usually approves registrations within 1–2 working days. We'll
  email you at <her address> when you can sign in." (the promise only when the gate said it will send it).

### 18.6 Tests

`tests/home-study.test.js` (every item, both builds), `tests/gate-client.test.js` (her files in parts
with the signal dropping, her fees, her password changed — against the real paste),
`tests/gate-appsscript-vm.test.js` §home, `tests/gate-contract.test.js` (fees and password on both gates),
`tests/gate-publisher.test.js` (fees files: who writes, who waits), and in browsers
`tests/browser/home-study.js` (`npm run test:browser:home-study`).
