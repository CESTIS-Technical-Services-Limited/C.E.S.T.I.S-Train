# The October 2026 upgrade — what changed, what to do, what is left

This upgrade went through the whole platform, from a live online class down to an examination
result and a certificate an employer can check. The aim was a training-school LMS the Centre can
rely on for years with as little upkeep as possible, without losing one record on the way.

## How it was done

1. **Audit.** Thirteen independent audits, one per area: live classes, attendance, coursework,
   exams, transcripts, certificates, accounts, sync and backup, the Offline System,
   communications, administration, the finance apps, and UI. They raised 290 findings, each with
   a file, a line and a failure scenario.
2. **Verification.** A second reviewer tried to disprove every finding, and a third reproduced the
   serious ones by running the real code. No finding was refuted.
3. **Fixes.** Eleven fix tracks, each in its own copy of the code. Every fix comes with a test
   that runs the page's real code, then each track was merged into one branch and re-tested as
   a whole.
4. **Final review.** A data-loss reviewer and a security reviewer went over the combined result.
   Every defect they found was fixed and pinned by a test that fails without the fix.
5. **Proof in a real browser.**
   - **Upgrade test.** The old version (the code before this upgrade) writes a whole Centre's
     data through its own pages: 74 stores and 815 records. Trainees, accounts, exams and
     results, 595 weekly attendance marks, certificates, fees, cashbook, payroll, chat and more.
     The new version then opens that data, three ways:
     - on the same PC
     - through the Offline System's server, with a brand-new device
     - through Google Drive (emulated), with a brand-new device

     Every record survives or is provably migrated. The attendance marks all reach the new dated
     register with the same status, and money totals are identical.
   - **End-to-end test.** A whole training day runs through the real screens on separate devices,
     with no console errors in any tab:
     1. Enrol an intake.
     2. Hold a live class and take attendance from it.
     3. Set and mark an assignment.
     4. Hold an exam, with a refresh mid-exam and essay marking.
     5. Produce the transcript PDF.
     6. Sign a certificate, let an employer verify it, then withdraw it.
     7. Publish an announcement and check the trainee's agenda.

   These two tests found and fixed 13 more defects that no reading of the code had shown. One
   was "Save Grades" never marking an essay. Another was a sync arriving while the Cashbook sat at
   its sign-in screen rewriting a quarter's opening balance.

**Final test results** (all run on the code as delivered):

| Suite | Result |
|---|---|
| `npm test` | 126 suites, 10,651 checks, 0 failed |
| `npm run test:syntax` | 236 files, 0 failed |
| End-to-end training day (`test:browser:flows`) | 134, 0 failed |
| Upgrade from the old version (`test:browser:upgrade`) | website 90, Offline System 77, Drive 42 — 0 failed |
| Main smoke (`test:browser`) | 101 |
| Security regressions | 58 |
| Accessibility | 49 |
| Sign-in gates | 36 |
| School Fee | 29 |
| Video room | 26 |
| Offline network | 24 |
| Certificate verification | 18 |
| Transcripts & admin | 11 |

The browser suites below the first two all passed with 0 failures.

The data rules every change was held to:

- Nothing stored is ever replaced by an empty or partial copy.
- Deletions are recorded as tombstones, never as silent gaps.
- Merges go record by record, and the newer edit wins.
- Every migration is additive: old keys are read, never destroyed, and stay as a backup.

---

## The owner's review round (23–28 October 2026)

After the upgrade above, the Centre's owner reviewed it screen by screen. Everything below was
shown to the owner in screenshots first, and merged only once approved or decided by them.

| Change | What it does | Where to look |
|---|---|---|
| **"Not Yet Competent" considers transcripts** | A trainee whose transcript is complete is no longer marked Not Yet Competent when the course ends. | `Core.courseEnd`, `tests/course-end-transcript.test.js` |
| **Certificate page 2** | The second column continues beside the first instead of running off the page. A seeded template opened in the editor keeps its "Full-time" course type. | `tests/cert-page2-columns.test.js`, `tests/cert-course-type-editor.test.js` |
| **The new test platform (Moodle-style)** | Question navigation panel, pages, flags, a summary before submitting, review with marks, question types (multiple choice, multiple answer, true/false, matching, short answer, numerical, essay), an instructor's results table with a column per question. | `tests/browser/exam-platform-preview.js` |
| **Light and Dark mode** | A sun/moon switch, a Theme choice in Edit Profile, and a switch in the test's navigation panel. Chosen per device; Dark stays the default. Every text colour is measured for contrast in both. | `tests/theme-tokens.test.js` |
| **No screen says where information is kept** | 1,270 places that named Google, Drive, the cloud, the Centre's server or the "broker" now use neutral words ("Sync Now", "Up to date", "Not synced yet", "Could not sync — try again or ask the office"). A scanner fails the tests if such wording comes back. | `node tools/scan-ui-wording.js`, `tests/ui-no-sync-source-wording.test.js` |
| **The eight UI improvements** | Search on phones; phone tables that keep the trainee's name in view; no text under 12px; picture descriptions; sign-in answers under the card, the signed-in person and a Lock in the top bar (an account menu on phones); one sync control (a calm "All saved" for trainees); labelled forms instead of `prompt()` boxes; the sibling apps in the dashboard's look, in Light and Dark. | `tests/browser/ui-preview-combined.js`, `ui-preview-a.js`, `ui-preview-b.js` |
| **Email sign-in and approval** | A trainee approved in the office can sign in on the PC they registered on (it used to say "awaiting approval" until someone pressed Sync Now). The registration screen says truthfully whether it reached the office. Instructors keep one record on shared PCs. The email button is hidden where it cannot work. | `tests/email-signin-approval.test.js`, `tests/browser/email-signin-flow.js` |
| **Duplicate "Disabled" accounts** | A cleared office PC no longer creates second and third accounts from the fee roll and chat roster. Provable leftovers fold into the real account, with a deletion record so they cannot come back; anything unsure stays for the administrator. | `tests/backfill-stub-fold.test.js` |
| **"Set a new password"** | The cursor no longer jumps back from "Confirm password" (an intermittent "Passwords do not match" for a first administrator). | `tests/force-change-pw-focus.test.js` |
| **A test that follows the trainee** | Answers are saved on the device and in the shared copy. Kicked out, crashed or disconnected, the trainee signs in and presses "Continue your attempt"; at another Centre PC too. The original clock stands, the newest answer per question wins, a submitted test cannot be reopened, and there is exactly one result per attempt. A trainee taking a test is not signed out part-way; a test whose time ran out is submitted at the next sign-in. | `tests/exam-attempt-travel.test.js`, `tests/browser/exam-resume.js` |
| **Shared files' version tags** | Every page asks for the current shared code files. The tags are now made from each file's content by `npm run stamp` (which `npm run build:offline` runs); nothing is bumped by hand. See *Keeping it healthy*. | `tools/stamp-versions.js`, `tests/version-tags.test.js` |

**Decisions the owner made in this round:**
- Trainees register at the Centre (or the office creates their account). A trainee's own phone
  away from the Centre cannot sync today; it now says so honestly instead of claiming success.
- Test answers are kept on the device **and** in the shared copy.
- Each trainee's device should get only that trainee's own data, through a free "gatekeeper"
  under the Centre's Google account, with a folder per trainee named with their student ID. This
  is being built in stages; the design is `docs/trainee-gate/DESIGN.md` (added with Stage 1).
  Until it is set up and switched on, everything works as described here.

**Still waiting on the owner:** the transcript's Date column (built on branch
`worktree-agent-a2dc79b6e1ddcefed`, commit 8f9f29c, shown in screenshots, not merged).

---

## The productivity audit round (28–30 October 2026)

Six areas were measured in real browsers with realistic Centre data: management and outcomes,
instructors, office staff, trainees at home, speed and data use, and upkeep (79 findings). The
plain bugs were fixed straight away; everything people would see changed only after the owner
saw screenshots.

| Change | What it does | Where to look |
|---|---|---|
| **Audit fixes (PR #349)** | Every trainee reaches a small-room live class; the idle lock leaves a class or an open sitting alone and accepts a trainee's password at home; pass rates from marked results; one counting rule per figure with its denominator; dropouts stay Incomplete; the full gradebook; no default answer key; no false "uploaded"; notices to their programme; contact details carried to the trainee and fee records; a warning before a receipt number is reused. | `tests/vc-small-room-joiners.test.js`, `tests/centre-figures.test.js`, `tests/pass-rate-from-marks.test.js` and the other tests named in each commit |
| **Live classes on less data (owner approved 30 Oct)** | Trainees start muted with the camera off; a muted microphone sends nothing; a trainee's camera goes to the instructor only; the instructor's picture budget is shared fairly as people join and leave; recordings at about 550 kbit/s; Large Class is put first above 6 trainees only once the Centre has its own video server. Measured, class of 6: a trainee's upload 553 → 6 kbit/s. | `tests/vc-room.test.js`, `tests/vc-page.test.js`, `tests/browser/vc-room.js` |
| **Home study (owner approved 30 Oct)** | A trainee's link opens on her own form; "Your class is live — Join class" and "Test open now — Start test" at the top of her home screen (her phone checks every minute around class time); My Progress shows her real figures; photos made about 0.4 MB on the phone and sent in parts that survive a dropped signal; My Fees and Change Password at home; her certificate downloads at home once approved; she is told when to expect approval and emailed when approved; the bell's glow stops after three pulses. The trainee sign-in program is version 3 (paste the latest when setting it up). | `tests/home-study.test.js`, `tests/browser/home-study.js`, `docs/trainee-gate/DESIGN.md` §18 |
| **Sync that rests, and chat that is never emptied** | An untouched office PC stops saving and uploading (≈2.9 GB a day → ≈2.4 MB); a big chat history or fee roll is no longer emptied at start-up; a change uploads the Main copy only, the extra copies every 30 minutes, at sign-out, or at once while Main fails; sign-in skips bytes it already has (month 10: 771 → 134 MB downloaded); the Centre network sends only changed keys, compresses its history and accepts files up to 512 MiB; the Cashbook checks before downloading; a new attendance mark no longer reads the whole register. | `tests/sync-idle-quiet.test.js`, `tests/chat-history-not-emptied.test.js`, `tests/backup-copy-cadence.test.js`, `tests/lan-partial-save.test.js`, `tests/browser/sync-quiet.js`, `tests/browser/backup-copies.js` |
| **Real figures for the board and the regulator (group E, owner approved)** | The board sees the fee money: billed, collected and owed by programme for the financial year, read only, in "$" (was "D"); three "fee" widgets that counted certificates now show money. "Earlier years still owing: $X (n trainees)" sits beside Outstanding on School Fee, the administrator's dashboard and the board's screens, never added into it. Reports has an intake and a period filter and a one-click **Programme return** (CSV and PDF). Measured on the audit's Centre: $1,785,000 billed / $909,000 collected / $876,000 owed, $140,000 from 10 earlier-year trainees — every figure equal to the hand count. | `tests/board-figures.test.js`, `tests/browser/board-figures.js` |
| **Group B: instructors teach, not type (owner approved)** | **Needs Attention** for instructors (their programme) and the office (everyone, with what each owes; the dashboard's "below 70% attendance" opens it): last attended, absences in a row, attendance, recent marks below the pass mark, work not handed in, phone, Message. **Coursework**: a comment with each mark (the trainee sees it on My Assignments, at home too), "Not submitted (n)" with Remind, Edit with the mark's history, work to mark first. **Tests**: Copy for the next intake; the builder keeps its draft on the computer ("Continue building"); Import Exam for instructors (own programme); exact fill-ins marked at once; Save & next; Mark by question. **Classes**: Upcoming / Past, a state on each, Edit, repeat weekly. **Message** on My Students. Instructors **upload files** for their own programme, and **propose unit results** the office confirms. The office sees the **marking backlog** (how old, on whom, work never handed in) and **registers not taken** on the last school day. New assignments, deleted ones and exams opening reach only the programme's trainees. | `tests/needs-attention.test.js`, `tests/coursework-feedback.test.js`, `tests/exam-reuse.test.js`, `tests/exam-marking-speed.test.js`, `tests/class-list.test.js`, `tests/message-trainee.test.js`, `tests/instructor-uploads.test.js`, `tests/unit-proposals.test.js`, `tests/office-watch.test.js`, `tests/notice-audience.test.js`, `tests/browser/instructor-tools.js` |
| **The office runs itself (owner approved 30 Oct, group A)** | "Office today" on both office dashboards; Admin Staff get the Administrator's working pages for the sections ticked, ticks per person; Admin Staff reset trainees' passwords; one New trainee form; home registration asks date of birth, gender, TRN, address, parent/guardian and emergency contact; first-sign-in codes and one sign-in slip per trainee; automatic receipt numbers R-2026/27-0001; requests with Open transcript / Certify / Mark collected and the trainee told; Student Progress moves several at once; announcements to one programme; School Fee covered only after 5 idle minutes; details save when a programme has no fee. | `tests/office-today.test.js`, `admin-staff-working-pages`, `new-trainee-form`, `sign-in-slips`, `fee-receipt-numbers`, `requests-run-themselves`, `student-progress-bulk`, `office-announcement-programme`, `fee-idle-cover`, `fee-unpriced-details`; `tests/browser/office-group-a.js` |

**Decisions the owner made in this round (29–30 October 2026):**
- Groups A–F of the audit's recommendations approved: the office (A), instructors (B), trainees at
  home (C), live classes (D), the board's and regulator's figures (E), keeping records safe for
  years (F). Each comes back as screenshots before it goes live.
- Admin Staff may reset **trainee** passwords (never staff or administrator passwords).
- Receipt numbers look like **R-2026/27-0001** (the financial year, then a sequence).
- The Centre-network server (Offline System) is kept as it is while there are no lab PCs.

## Before you deploy — the Centre's checklist

1. **Sign-in passwords.**
   - The published default password (`cestisadmin123$`) no longer opens anything while a real
     administrator exists.
   - If every administrator is still on it, the first person to sign in must set a new password.
   - Payroll and the Cashbook follow the same rule.
   - Tell staff before release.
2. **Cashbook sign-in** now uses the LMS administrator / admin-staff accounts stored on that PC.
   Open the LMS once on each finance PC first.
3. **Admin Staff who edit trainees** need the new tick *Student Progress — manage* (off by
   default) in Settings → Admin Staff access.
4. **Record pages need a dashboard sign-in.** These pages now take the viewer from the signed-in
   dashboard session:
   - Transcript-Grades, Student Progress and Cert-Transcript-Requests
   - Staff Clock-in, School Fee and Virement
   - Income & Expenditure, Payments & Invoices, Invoice, Quote, Purchase Order and Payment
     Voucher
   - the MegaData pages (administrators only)

   Opened directly with no session, they show "sign in first". The web address can only narrow
   what they show, never widen it. Finance staff should open them from the dashboard, or sign in
   to the dashboard on that PC first.
5. **Certificate verification for employers.** Create the Centre's signing key once, back it up,
   and publish its public half (`docs/CERTIFICATE-SIGNING.md`). Until then, certificates verify
   the old way.
   - The key is kept locked on the administrator's PC: it can sign but cannot be copied out.
   - Its backup file can be downloaded **once**. Store it somewhere safe and off the website.
   - A lost backup means creating and publishing a new key.
6. **Video classes.**
   - The free public relay servers the old code used no longer exist.
   - If trainees on mobile data cannot connect, add a relay (TURN) server in Settings →
     Video Conference. Nothing paid is required by the code.
   - The *Large Class* option should point at a Jitsi server the Centre controls. The public
     meet.jit.si no longer allows long embedded meetings.
   - Once the Centre's own Jitsi server is set, the start screen puts Large Class first for
     classes of more than 6 trainees. Until then the built-in room stays first (it carries up to
     8 people), with one line saying Large Class will save data once the server is added.
7. **E-mail (EmailJS).**
   - In the EmailJS dashboard, restrict the allowed origin and set a daily cap (see
     `LONGEVITY-AUDIT.md`).
   - For the Support form to deliver online, create a support template and set its id
     (`systemSettings.supportEmailTemplateId`). Until then the form offers an e-mail link instead
     of claiming "sent".
8. **Two decisions only the Centre could make** (both now made, see the review round above):
   - **Core/Elective column.** The official transcript's *Core/Elective* column prints
     Core/Elective. The owner asked for a separate Date column as well; it is built and waiting
     for the owner's confirmation from screenshots.
   - **Automatic NYC.** Decided: the course-end "Not Yet Competent" status now considers
     transcript results.
9. **Light and Dark mode** are chosen per device. Nothing to set up; Dark is the default.
10. **Trainees taking tests** can continue on another Centre PC. Tell invigilators: a trainee
    whose PC fails should sign in at another PC and press *Continue your attempt*.

---

## What changed, area by area

### Live classes (video)
- **Seeing and hearing the instructor.** Trainees now see and hear the instructor whatever order
  the connection arrives in, including trainees with no camera or with the camera switched off.
- **Leaving and rejoining.** Leaving releases the room, so the instructor can rejoin or restart.
  Logging out leaves the Large Class properly.
- **Who controls the room.** Only the host's own connection can end, kick or mute. The host
  admits each joiner, checking room size, admin-only meetings and anyone already removed.
- **Room codes** are 10 random characters. Old codes still work.
- **Bandwidth.** Trainees send video only to the instructor, not to each other, which cuts phone
  bandwidth sharply. Phones send 640×360.
- **Configuration.** Relay (TURN) servers and the Large Class server are configured in Settings.
  The dead public relays are removed, and reconnects back off instead of hammering.
- **Recordings.**
  - They are written to the device as they record, so a crash can be recovered.
  - Every voice is mixed in.
  - Everyone is told when recording starts.
  - Uploads resume.
  - Recordings attach to their class session.
- **Class sessions** move scheduled → live → completed, so *Live Now* and *Past Recordings*
  work.

### The office runs itself (owner's decision, group A)
Measured in real browsers with the audit's own scripts, before and after.
- **Office today** (both office dashboards): registrations waiting, certificate/transcript
  requests waiting (with the oldest one's wait), trainees' records missing a telephone, email,
  date of birth or gender, certificates to hand out, programmes with no fee set — each line one
  click from its page, shown only to somebody who may act on it. The Administrator's open menu
  groups are remembered on that computer. A new Admin Staff member with no duties is no longer
  told "0% — Needs Improvement".
- **Admin Staff do the work they are given.** A ticked section opens the Administrator's own
  working page (Attendance, Announcements, Calendar, Certificates, Online Exams, Resources,
  Reports, Training Centres); every action checks the tick. Deleting a training centre,
  recovering from backups, Settings, account deletion and the trainee sign-in setup stay the
  Administrator's. **Ticks are kept per person**: Settings → Admin Staff Access → "Whose
  access". The grid's own ticks are the default for anybody without ticks of their own, so
  nobody lost access. **Admin Staff reset trainees' passwords** (Trainee Accounts → "A trainee
  cannot sign in?"), never a staff, instructor or administrator password.
- **One New trainee form** behind every add-trainee button (the dashboard's Add Student, Student
  Progress's + Add Student, + Add Trainee Account, Settings → Create User for a trainee): the
  sign-in, trainee record and fee record together, with gender and optional details. The **home
  registration form** also asks date of birth, gender, TRN (optional), home address, a parent or
  guardian (optional) and an emergency contact; Verify Users shows them, and approval puts them
  on her trainee and fee records (blanks only). The trainee sign-in checks them with the same
  rules (`CESTISCore.accountAccess.traineeDetails`); `trainee-gate/Gate.gs` now passes the
  whole form to the check (one line). The gate has not been set up, so nothing is pasted twice.
- **First-sign-in codes and sign-in slips.** Approve All (an intake imported from Excel), a New
  trainee with no password typed, and a trainee's password reset each give a random 10-digit
  code, kept only as its hash, like a password. The office prints ONE slip per trainee (name,
  username, code, the trainee sign-in link and, once the trainee sign-in is on, its QR code,
  and three steps) — only at that moment: the codes are forgotten when the dialog closes. At
  first sign-in she must choose her own password (on an office computer at once; at home through
  the trainee sign-in's password change).
- **Receipt numbers** are filled in: `R-2026/27-0001` — the financial year as School Fee
  defines it (April–March), then a 4-digit sequence per year, one past the highest number this
  computer holds from every office computer. A number typed from a paper receipt book is kept
  (and still asked about when already used). When the other office computers' payments could
  not be checked in the last two minutes, or this computer has a payment not yet sent, the
  number carries this computer's two letters (`R-2026/27-0042-K7`), so two computers can never
  give the same number. Receipts already given are never renumbered.
- **Requests run themselves**: oldest first with "N days waiting"; Open transcript, Certify and
  Mark collected on each row; one collected mark updates the request and the Certificates page;
  the trainee is told in her own bell each time her request moves on.
- **Student Progress** moves several trainees at once (tick boxes, "Move selected to…", one
  combined certificate checklist). **Announcements** can go to one programme's trainees. **School
  Fee** is covered only after 5 minutes without use, and saves a trainee's details when her
  programme has no fee set yet ("set it under Fee Structure").
- Checklist for the Centre: give each Admin Staff member their own ticks if they differ (Settings
  → Admin Staff Access → Whose access); print slips when approving an imported intake; tell the
  office that receipt numbers are now automatic (paper receipt books still work).

### Live classes on less mobile data (owner's decision, group D)
Measured first, in headless Chromium with fake cameras and a speech-like fake microphone: an
instructor and 6 trainees on phone settings, every connection's bytes read from the browser
(`RTCPeerConnection.getStats()`), plus IP/UDP headers, as a mobile network bills them.
- **What the measurement found.**
  - A muted microphone still sent 50 packets of silence a second: about 40 kbit/s (18 MB an
    hour) to *every* other person in the room. Six muted trainees each uploaded 199 kbit/s of
    silence.
  - With the camera on and the microphone open (how everyone joined), a trainee on a phone
    uploaded about 760 kbit/s in a class of 6 — more than a typical 750 kbit/s mobile uplink.
  - The instructor's picture budget was worked out once, as each trainee arrived, so the first
    four kept 1.2 Mbit/s each for the whole class (6.7 Mbit/s in all instead of 5).
- **What changed.**
  - Trainees join with the camera **off** (it is not even opened) and the microphone
    **muted**. The lobby buttons say "Microphone off" / "Camera off" in words; in the room the
    buttons are red with a line through, and one tap turns them on. Staff start as before.
  - A muted microphone now sends **nothing** (its sender is stopped, not just silenced). The
    instructor's Mute, Unmute and Mute All do the same, and the host's camera-off really stops
    the trainee's camera.
  - Everyone still hears whoever unmutes (a question asked aloud). Measured against "voice only
    to the instructor", the difference with everyone muted is 0.9 kbit/s per trainee (about
    0.4 MB an hour), so the classroom was kept. Trainee cameras go to the instructor only.
  - The instructor sees who is muted (a 🔇 on the tile and in the participant list) and whose
    camera is off (their initial instead of a black box).
  - The instructor's picture budget is shared again whenever someone joins or leaves.
  - When the class's register has more than 6 trainees and the Centre has its own Large Class
    video server, the start screen puts **Large Class** first, in one line saying why. Without
    one (the public fallback cuts embedded meetings off after a few minutes), the built-in room
    stays first and one line says Large Class will save data once the Centre's own video server
    is added. The instructor can always choose either.
  - Recordings are made at 550 kbit/s of picture and 64 kbit/s of sound: at most about 276 MB
    an hour (it was up to ~1.1 GB). Writing on a whiteboard reads exactly as before.
- **Measured, class of 6 trainees** (as they join; per trainee): upload 553 → 6 kbit/s;
  sound from classmates 325 → 1 kbit/s; the instructor's download 1.3 Mbit/s → 35 kbit/s.
- **Per trainee per hour** (worked out from measured costs per connection, the instructor's
  picture at its ceiling): about 1.0 GB → 0.4 GB in a class of 6. Almost all of what is left is
  the instructor's own picture and voice. Recordings measured: a demonstration 4.7 → 1.7 MB a
  minute, a whiteboard 1.9 → 1.4, a camera-like scene 8.6 → 3.0.
- Tests: `tests/vc-room.test.js`, `tests/vc-page.test.js`, `tests/browser/vc-room.js`.

### Attendance
- **A dated register.** One mark per trainee per actual date for the whole course
  (`voctrain_attendanceRegister`). It replaces the single Mon–Fri row per quarter, which each
  week overwrote.
- **Migration.**
  - Every old weekly mark is carried over and labelled as migrated.
  - Rows that were never really marked come over as "unconfirmed".
  - The old keys are read, never written.
- **New statuses.** *Excused* and *No class* don't count as absences.
- **Rates.** One shared rule (present + late over sessions actually held) is used by every view
  and every role.
- **The register page.**
  - It navigates by week and saves within about a second.
  - It has a "Mark all present" button.
  - It locks per intake, not by name.
  - It offers a register export.
- **Attendance from live classes** is offered to the instructor to confirm, never written
  automatically.

### Coursework
- **Grades.**
  - Marks are percentages of each assignment's own maximum, with weights applied.
  - A mark of 0 is a mark.
  - Provisional exam results are left out.
  - Every grade keeps who gave it, when, and what it replaced.
- **Resubmission.** Optional per assignment; earlier attempts are kept.
- **Double submissions.** Double-tapping Submit no longer duplicates a submission.
- **Due dates** mean the end of that day in Jamaica.
- **Files.**
  - 5 MB per file.
  - A file uploaded to Drive is kept as a Drive link, not copied into every backup.
  - New submission files are private to the Centre's Drive account.
- **Resources** are scoped to the trainee's programme.

### Examinations
- **Authoring.**
  - Edit → Cancel → Create makes a new exam.
  - Editing saves every field (date, time, duration, pass mark, programme).
  - An exam created after its window does not close instantly.
  - Deleting an option no longer moves the answer key.
  - An imported paper with no answer key is flagged for the instructor instead of being keyed
    to "A".
- **Taking an exam.**
  - A refresh, crash or power cut resumes with the answers and the original clock.
  - On a shared PC an attempt stays with its own trainee.
  - A submitted result that has not uploaded yet survives the next person's sign-out.
  - Late starters get only what is left of the window.
  - Options are real radio buttons, usable by keyboard and screen reader.
- **Results.**
  - Trainees no longer see classmates' scores.
  - Correct answers are hidden until the exam closes, unless staff release them early or
    withhold them.
  - Results awaiting marking are shown as "Awaiting marking", never as final.
- **Status and identity.**
  - Only staff devices change an exam's status, using the Centre's time zone.
  - Exams are identified by id, so two exams with one title no longer merge.
- **Deleting an exam** archives its results instead of destroying them.

### Grades, transcripts and Student Progress
- **Renames and moves.** Renaming a trainee or moving them to another programme carries every
  record with them: grades, transcript header, requests, profile, attendance, results and
  approvals.
- **Unit credit.** Exams credit units by unit code and programme, so one exam no longer credits
  several units.
- **One pass rule.** The exam's pass mark, then the unit's, then the plan's, else 60%.
- **Competency results.** C, Competent and NYC are counted as results.
- **Frozen transcripts.** An issued transcript keeps a copy of the unit catalogue, so later
  catalogue edits don't change a graduate's transcript.
- **Typed grades** survive a refresh, and "Save all changed rows" saves them together.
- **Requests.** Transcript and certificate requests reach the office from trainee devices, and
  status changes come back.
- **Student Progress** acts on record ids, never on row positions captured earlier.

### Certification
- **Numbers.**
  - A certificate number never changes once issued.
  - New numbers carry a suffix (`PL-2026-4821-QX`), so two devices cannot give one number to
    two people.
  - Printed numbers are untouched.
- **Withdrawals.** A withdrawn certificate stays withdrawn through sync and verifies as
  *Revoked*.
- **Verification for employers.**
  - Signed QR codes are checked in the employer's own browser with no sign-in.
  - A tampered certificate shows "Not Verified".
  - Unsigned certificates keep the old lookup.
- **Eligibility checklist** (warns, never blocks): units competent from the transcript,
  attendance against 70%, and fees.
- **Bulk approval** saves once instead of once per trainee. Templates no longer borrow another
  programme's content.

### Accounts and sign-in
- **Default passwords.**
  - No published default password grants access.
  - Deleted built-in logins stay deleted.
  - The once-per-device reset back to the default is gone.
- **Registration and approval.**
  - Self-registration can only ask for trainee or instructor.
  - Approve All never re-enables an account an administrator switched off.
  - Disabled accounts stay disabled on every device.
- **Backup codes.** Regenerating them revokes the old ones everywhere.
- **Sessions.**
  - Idle lock after 20 minutes for staff and 60 for trainees.
  - A 2-minute warning before the 8-hour session expires.
  - The lock now also holds for other tabs.
- **Recovery and export.**
  - Changing the recovery e-mail needs the password.
  - Export is administrator-only, and Import merges instead of overwriting.
- **Codes on screen.** The on-screen "demo mode" reset codes in School Fee, Payroll and
  Clock-in are gone.
- **Linking accounts to trainees.**
  - It uses ids, never a name alone.
  - A trainee's own name change becomes a request for the office.
  - Global search shows a trainee only their own records.

### Communications
- **Announcements.** Trainees have an Announcements page: full text, newest first.
- **Agenda.** A trainee agenda combines exams, assignment due dates, class sessions and
  calendar events, without storing anything twice.
- **Calendar** events are added through a validated form.
- **Notifications.** *Read* and *Clear all* are per person; one person clearing the bell no
  longer deletes notices for everyone.
- **Chat.**
  - Identity is the signed-in account.
  - Administrators' removals stick.
  - Polling slows when idle or hidden.
  - Logout stops it and leaves no one else's messages on a shared PC.
  - New chat files are private.
- **Support form.** It no longer says "sent" unless it was.

### Administration
- **Re-enrolment.** A deleted trainee no longer blocks a different person of the same name from
  enrolling later.
- **Centre ids.** New centres never reuse a deleted centre's id.
- **Renames and transfers.**
  - Renaming one intake no longer renames other intakes with the same name.
  - Transfers no longer move a namesake in another centre.
- **School Fee details.** Enrolling no longer writes blanks over School Fee details.
- **Reports.** Corrected certifications by month, certified this year, dropout rate and the
  low-attendance alert.
- **External systems** open in their own tab. There is no advice to click past certificate
  warnings.

### Figures for the board and the regulator (owner's decision, group E)
- **One rule for fee money** (`CESTISCore.centreFigures.fees`), the School Fee page's own:
  - an account belongs to the financial year (April–March) of its enrolment date, or of the day
    it was created; an account with no date at all is counted in every year, so nobody is hidden;
  - **billed**: the tuition of that year's accounts; **owed**: their balances as at today
    (tuition less every payment recorded for them); **collected**: payments dated in that year;
  - **earlier years**: accounts of an earlier year that still owe — a separate line, never
    added into owed;
  - an account with no fee set and nothing paid is "no fee set yet", never "owes nothing".
- **The board's money view.** The CMC board's dashboard, Financial Overview and Oversight Portal
  show billed, collected and owed by programme for the present financial year, with the earlier
  years beside Owed.
  - Why the board had no fee figures: the School Fee books were never on the list of books the
    board's page reads (`CMC_SHARED_FILES` in `cmc-portal.js`). Nothing decided it; they were
    simply left off, and three widgets labelled as fees were filled with certificate counts.
  - How it reads them now: exactly like the Cashbook and the other books — the School Fee file
    is in the board's `reads`, never in its `writes` (which name only the virement register).
    `CMC_FEE_KEYS` names the fee keys the board may never write. A board member's session also
    no longer runs the LMS-to-fee mirror, so it never creates or edits a fee record. The browser
    suite checks the fee roll and payments are byte-identical after every board page.
  - Money is written "$1,785,000" everywhere on the board's screens (it was "D1785000").
  - "Fee Completion" (a certificate rate) is now **School Fees Owed**; "Fee Collection Status"
    (certified against everyone else) is now a doughnut of money collected and owed; "School
    Fees Details" (a roster of stages and GPAs) is now the money by programme. The roster moved
    to the Completion card, where it belongs. Programme Breakdown's completion uses the one rule
    (over ended intakes, with its denominator).
- **Earlier years still owing** appears under School Fee's Total Outstanding (not under "Every
  year", which already includes it), on the administrator's dashboard (a new School Fees card)
  and on the board's screens.
- **The Programme return** (Reports, top of the page). Choose an intake and a period (a
  quarter, a whole financial year, or all dates; the present quarter by default), then
  Download CSV or Download PDF. A plain heading says which intake and period it covers and the
  day the figures are as at. Per programme and intake: applicants, enrolled (admitted), active,
  completed, certified, Not Yet Competent, Incomplete/dropouts, completion, attendance, test
  pass rate, and fees billed, collected in the period and owed — by the Centre's counting rules,
  each rate with what it is a rate of — and the same counts by gender and by age band, with
  "Not recorded" as its own row. It is called a "Programme return"; it is not any agency's form.

### Finance and HR apps
- **Every "Sync", "Connect" and "Cloud Sync Required" path merges record by record** instead of
  replacing whole datasets. This covers the Cashbook, School Fee, Clock-in and Payslip.
  Deletions stay deleted.
- **Cashbook rows** have stable ids across devices, so no cheque is doubled or lost. The payroll
  link no longer zeroes another month's salary.
- **Virements.** An edited approved virement loses its approval and cannot regain it.
- **Financial year.** It is no longer hard-coded to 2025/2026.
- **The Google-free backup export** now includes payroll, fees, reconciliation and every
  deletion list. Import restores cashbook quarters, payroll and old-style rows properly.

### Data safety and sync (all apps)
- **Logout** never discards a staff device's work that has not reached Drive or the Centre
  server. It is kept and uploaded at the next sign-in. A trainee using that PC in between does
  not clear it.
- **Grades and marking** sync per trainee with a timestamp: manual exam marks, transcript
  overrides and assignment grades. Removing a grade keeps a dated record.
- **Deletions** are recorded and respected everywhere, including deleting the last record of a
  list.
- **Failed downloads.** A failed or garbled download is never treated as "the cloud is empty".
- **Device clocks.**
  - A device clock more than a day ahead can no longer overwrite anyone's records.
  - Its own edits are re-dated to the correct time instead of being lost.
  - A warning shows when a device's clock disagrees with Google's.
- **Restores.** Importing a backup pauses auto-save, so the restore is not undone.
- **Sync cost (29 October).**
  - An untouched dashboard no longer saves or uploads anything; an edit made at any moment,
    during an upload too, still goes up on the next 5-second tick.
  - A change uploads the Main backup copy only. The four other folder copies, the per-person
    copy and the master snapshot go up together at most every 30 minutes while the Main copy
    is ahead of them, at sign-out, and at once (at most every 5 minutes) while the Main copy
    cannot be written. Every reader still reads all of them, newest record winning.
  - Sign-in and Sync Now download each distinct copy once: a copy whose bytes (Drive's MD5)
    this device has already merged is not downloaded again.
  - The first save after a sign-in sends nothing only when the Main copy still has the exact
    bytes this device last put there (same MD5) and the device would send exactly that data
    (same hash). Each device keeps that note for itself (`cestisLastUploadHash`); it never
    travels. A device upgraded from an older build has no note, so it uploads once, as before.
  - The chat file is uploaded only when the chat changed; the Cashbook checks its file's
    version before downloading it.
  - A PC's chat history, notifications and School Fee roll are read again once the browser's
    database is open; nothing is written over them before that.

### The Offline System
- **Generated from the main files.** `Offline System/` is produced by
  `node tools/build-offline.js` (`npm run build:offline`). A test fails if the two builds ever
  differ, so a fix can no longer reach one Centre and not the other.
- **Saving works.** The offline dashboard saves. Before, its save step was undefined, so nothing
  persisted.
- **Network sync merges record by record.** A trainee's logout, or two PCs saving at once, can
  no longer wipe the Centre's records.
- **The local server.**
  - Each save is written safely and merged with what the server already holds.
  - The last 40 versions of every data file are kept in `data/.history`: the newest 3 as plain
    `.json`, older ones compressed (`.json.gz`; extract one before copying it back).
  - A save sends only the keys that changed; the server merges them into its file. It takes
    saves up to 512 MiB.
  - It tells a missing file apart from one it could not read.
- **Offline gates.** The Cashbook and certificate downloads work offline, with the Centre's
  server acting as the central store.
- **Certificates on a trainee's own device.** A certificate design's background images are kept
  on the Centre's server too (one `CESTIS_CertImage_*.json` file per page), sent there by the
  staff PC that saves the design, and read by any device building a certificate. Only image
  files up to 10 MB of data are sent or used. A staff PC holding designs saved before this sends
  the missing ones when staff sign in. Online, Google Drive does the same job, as before.

### UI, accessibility and speed
- **Keyboard and focus.**
  - The whole dashboard works from the keyboard, with visible focus.
  - Sign-in is a real form: Enter works and password managers work.
  - Dialogs move focus in and return it when closed.
- **Messages.**
  - Readable error messages (6:1 contrast or better).
  - Errors stay 20 seconds and are announced to screen readers.
  - Long messages scroll.
- **Contrast.** Muted text now meets the WCAG AA contrast standard.
- **Phones.** No sideways scrolling in Student Progress, and transcript tables scroll inside
  their card.
- **Badges.** *LIVE* shows only when a class you can join is running.
- **Faster loading.** Heavy libraries load only when first needed. First paint on a slow phone
  connection fell from about 24 s to about 12 s (Slow 3G, simulated).
- **Installable app.**
  - The site installs on phones, and pages open from a cache when the connection drops.
  - The cache always tries the network first, so an update is never hidden.
  - Kill switch: deploy a file named `sw-disable` next to `index.html`.

---

## Keeping it healthy (minimum maintenance)

- **Before every change is published, run:**
  ```
  npm run build:offline        # stamp the ?v= tags, regenerate the Offline System (a test fails if you forget)
  npm test                     # every Node suite; ends with a summary and names every suite that failed
  npm run test:syntax          # every JS file parses
  NODE_PATH=/opt/node-tools/node_modules npm run test:browser   # and the other test:browser:* suites
  ```
  The same checks (and three quick browser suites) run on GitHub for every pull request and every
  change to `main` (`.github/workflows/checks.yml`): a red cross there means do not publish.
- **The browser suites** (`npm run test:browser`, `:flows`, `:upgrade`, `:offline`, `:auth`,
  `:cert`, `:vc`, `:ui`, `:security`, `:transcripts`, `:fee`, `:exams`, `:email`, `:uib`,
  `:combined`, `:resume`) need Playwright's Chromium. Set `NODE_PATH` to wherever
  `playwright-core` is installed. Run them one at a time: `:upgrade` and `:resume` each take
  more than ten minutes (`:resume` can be split with `EXAM_RESUME_ONLY='^[1-4]'` and `'^[5-7]'`).
- **Before publishing, also run** `node tools/scan-ui-wording.js`. It must report 0: no screen
  may say where the Centre's information is synced from or kept (the owner's rule).
- **Never hand-edit a generated file in `Offline System/`.** Change the root file and regenerate.
  Only the server, signalling, store, certificate, launcher and README files there are
  maintained by hand.
- **Version tags are automatic.** Each page asks for a shared file as `cestis-core.js?v=3f9a2c1d`:
  the tag is made from the file's own content, so a changed file gets a new tag on every page and
  browsers fetch the new copy. After changing any shared file, run `npm run stamp`
  (`npm run build:offline` runs it), and commit. Nothing is bumped by hand any more;
  `tests/version-tags.test.js` fails if a tag does not match its file. The service worker always
  tries the network first.
- **New pure logic belongs in `cestis-core.js`** with a Node test, called from the pages. This is
  the pattern the whole upgrade follows.
- **Certificate signing key:** keep the backup somewhere safe and off the website. Never commit
  it. `.gitignore` already refuses `*signing-key-PRIVATE*.json`.

### Changing the Centre's account

For a lost Google account, a new EmailJS account, or a Drive folder deleted for good. The
records are not lost (every office PC holds them); sync, trainee sign-in from home and e-mail
stop until the pages point at the new account. Everything the pages need is in **one file,
`cestis-config.js`**:

1. In the new Google account, make the folders: one for each line under `folders` in
   `cestis-config.js` (the comment beside each says what it holds). A folder's id is the last
   part of its address: `https://drive.google.com/drive/folders/<id>`.
2. Open `cestis-config.js` on GitHub, press the pencil, paste each new id over the old one
   (keep the quotes), and save.
3. A new Google sign-in client (Google Cloud console → APIs & Services → Credentials → OAuth
   client ID, a *Web application* whose JavaScript origin is the site's address) goes in
   `googleClientId`. A new EmailJS account's public key, service id and template id go under
   `emailjs`.
4. Trainee sign-in from home: set the gate up again in the new account (`trainee-gate/SETUP.md`)
   and give it the same sign-in client id: set its `GOOGLE_CLIENT_ID` script property, or change
   `GATE_DEFAULT_CLIENT_ID` in `trainee-gate/Gate.gs` and run `npm run build:gate`. A new gate has
   a new address, so trainees need the new link or QR code.
5. Run `npm run build:offline` and `npm test` (`tests/centre-config.test.js` fails if any page
   still names an old id, or if the gate's client id differs), commit and publish. Then sign in
   on the office PC with the latest records and press Sync Now.

### Updating the payroll rates (once a year, or when the Government changes one)

Payroll's **Fetch Current Rates** reads `payroll-rates.json` from this site first (the older
Drive copy and the first published list are only fallbacks). To change a rate:

1. On GitHub, open the Centre's repository and click **`payroll-rates.json`**.
2. Click the **pencil** (Edit this file).
3. Change only the numbers that changed (keep every comma and quote), and set `"fiscalYear"`
   (e.g. `"2026/2027"`), `"effectiveDate"` and `"lastUpdated"` (as `YYYY-MM-DD`).
4. Click **Commit changes…**, write a short note (e.g. "Payroll rates 2026/27") and confirm.
5. Wait a few minutes for the green tick beside the change (the checks test the file: a red cross
   means a number or a comma is wrong). Then in Payroll → Settings press **Fetch Current Rates**,
   check the figures, and press **Save Settings**.

On the Centre's own network with no internet the button cannot fetch anything; type the rates
in Settings as before.

The Qualification Plans page also lists one folder per
qualification (in `Qual-Plan-Curriculum.html`): re-link those documents if they were in the old
account.

---

## Known limits, stated plainly

These need a real server, or a decision by the Centre. They are documented, not hidden.

- **Every signed-in device holds the whole Centre dataset.** Access control is enforced in the
  browser. A determined trainee with developer tools can read other people's records on their
  own device. Answer keys travel to trainee devices too: they are no longer in the trainee's
  attempt, and correct answers are not shown until released. After a trainee signs out, the
  device still keeps the account list (with password checks) and the tests. The owner approved
  the fix, the "trainee gate" (`docs/trainee-gate/DESIGN.md`), which is being built in stages.
- **Lab PCs keep the Centre's Google account signed in** to the browser after staff press Sync
  Now, so anyone at that PC could open the Centre's files in another tab. Until the trainee
  gate's "shared computer" setting arrives, staff should sign that account out of the browser
  after use.
- **Uploading a resource file** (the Resource Manager's upload, now also the instructor's
  "+ Upload File") needs sync turned on on that PC. On the Centre's own network without it,
  "+ Add Link" still works.
- **The test builder's draft** is kept on the computer it was built on (on purpose: a half-built
  test and its answers go nowhere else). Building on one PC and finishing on another means
  saving it first.
- **A trainee's own phone away from the Centre** cannot sync (the owner chose registration at
  the Centre for now). The trainee gate is what will let trainees sign in from home.
- **A test moving between devices:** a PC that loses power suddenly may hold up to its last
  30 seconds of answers that another PC cannot see yet. They are not lost; they stay on that PC.
- **The Offline System's access key** can be fetched by any device on the Centre network.
  Real per-user sessions on the local server are the next step. Until then any device that has
  the key could also replace a certificate design's background image on the server (devices
  only ever use an image from it, and the last 40 versions are kept in `data/.history`).
- **Video and chat identity online.** These rest on room codes and connection ids. A trainee who
  knows a room code can still try to take the host's place online; the instructor is warned and
  told to start a new code. On the Centre network the server now issues hosting only to staff
  who sign in, so this cannot happen there.
- **A trainee's live-class data is now mostly the instructor's own picture.** In the built-in
  room each trainee receives it at up to 833 kbit/s in a class of 6 (about 0.4 GB an hour with
  the voice). A lower ceiling for phones would cut that further; it is the owner's decision.
- **Files shared publicly by the old code** keep their public links. Nothing was revoked
  automatically.
- **Clocks.** A device whose clock is wrong by more than a day, with no way to reach Google or
  the Centre server, still has its clock trusted for its own view.
- **The Programme return for a past quarter** shows enrolment and stages as they stand today:
  the records keep no history of when a trainee's stage changed. Attendance, marked test results
  and payments are limited to the period. Attendance follows the one rule (trainees in
  training), so an intake that has ended shows no attendance figure.
- **The administrator's School Fees card** reads the fee books this computer holds. They are
  brought up to date whenever School Fee is opened on it. (The board's screens fetch them in the
  background, the way they fetch the Cashbook.)
- **Trainees with no fee record yet.** When the trainee roll is loaded, the dashboard creates a
  placeholder fee record (no fee set) for any trainee School Fee does not have — applicants
  included, as before. They count as accounts with "no fee set yet", never as money owed.

---

## Recommendations

### UI improvements (all eight now made)

The UI audit made 159 recommendations, and the ones that could be made safely without touching
data were done in the upgrade. The eight below were left open; **the owner approved all eight in
the review round and they are now built** (see the table above). They are kept here as the
record of what each one was for.

1. **Search on phones.** The top search box has no phone layout. An expanding search icon is a
   small, safe change, and the obvious next one.
2. **Phone layouts for the busiest tables:**
   - the attendance grid
   - the finance tables
   - the certificate pages
   - chat
   - the video room
   - the gradebook
   - the users table

   Each lives inside its own page's render code, so each needs its own careful pass. The
   pattern is the one already used for transcripts: the table scrolls inside its card, never
   the page.
3. **Minimum readable text size.** About 350 style rules still use 9–11px text. Raising them to
   12px or more needs a design pass across every page, not a single token change.
4. **Sign-in feedback.**
   - Show sign-in errors inline instead of in a pop-up.
   - Show who is signed in, with a *Lock* button.
   - Show a short notice explaining the "sync before sign-in" step for staff without a Google
     account.
5. **A sync health chip.** One small indicator ("All saved" / "3 changes waiting" / "Offline")
   on every page. The data is already tracked by the pending-upload marker and the unsynced
   counters.
6. **Image descriptions.** 15 images have no alt text. Each needs a human judgement on whether
   the picture carries information.
7. **One look across the sibling apps.** School Fee, Cashbook, Payroll and Clock-in each have
   their own styling. A shared stylesheet would make the platform feel like one product.
   This is large but low-risk if done page by page.
8. **Remaining pop-up questions.** The remaining `prompt()`/`confirm()` chains (mostly in the
   finance apps) should become proper forms with validation, as the calendar now has.

### Feature roadmap (zero-cost, in priority order)

The auditors also proposed 110 features. These are the ones that matter most for a training
school, in the order they pay back:

1. **Role-scoped data (the biggest remaining gap) — approved and being built.** For trainees
   this is the "trainee gate" (`docs/trainee-gate/DESIGN.md`): a free gatekeeper under the
   Centre's Google account gives each trainee's device only that trainee's records, from a
   folder named with their student ID; tests reach trainee devices without answer keys and are
   marked by the gatekeeper; the Centre's own server does the same on its network. Staff devices
   are unchanged. (The MegaData broker's role-scoped reads, `docs/02-MEGADATA-ARCHITECTURE.md`,
   remain the longer-term path for staff roles.)
2. **Audit trails.** One "who changed what, when, and what it was before" log, visible to
   administrators, covering:
   - grades and attendance (both already keep per-record history)
   - certificates (issue, approve, revoke, collect)
   - accounts and finance

   This is what an HEART/NSTA moderation visit asks for.
3. **Question bank and fair exams.**
   - Random pools per unit and option shuffling.
   - Attempts and retakes with accommodations (extra time).
   - Regrading or voiding a question, with item analysis.
4. **Trainee self check-in.** A rotating code or QR shown by the instructor, confirmed into the
   register (with the same "instructor confirms" rule as live-class attendance).
5. **Intake (cohort) management and close-out.**
   - A first-class intake with its dates, roll, register, exams and results.
   - An end-of-intake archive that freezes it and keeps the working data small for years.
6. **Scheduled local backups.** Every week, a full backup to a folder or USB on the office PC,
   with a merge-restore preview. This removes the last dependency on Google for disaster
   recovery.
7. **Calendar export (.ics) and urgent-notice fallback** (an e-mail or WhatsApp link), so
   trainees get reminders on their own phones.
8. **Statement of Attainment and batch certificate PDFs.** Partial completions get a record,
   and a whole cohort's certificates come out in one file.
9. **Marking rubrics and structured feedback** for assignments, and bulk gradebook CSV
   export/import that includes the marks.
10. **Live captions and quick polls in class.** These are accessibility and engagement tools
    that need no server.
