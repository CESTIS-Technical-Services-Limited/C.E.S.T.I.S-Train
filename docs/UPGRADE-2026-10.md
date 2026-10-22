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
   Every defect they found was fixed and pinned by a test that fails without the fix. An upgrade
   test loads a Centre's data written by the old code into the new code in a real browser. An
   end-to-end test drives a whole training day through the real screens.

The data rules every change was held to:

- Nothing stored is ever replaced by an empty or partial copy.
- Deletions are recorded as tombstones, never as silent gaps.
- Merges go record by record, and the newer edit wins.
- Every migration is additive: old keys are read, never destroyed, and stay as a backup.

---

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
4. **Record pages need a dashboard sign-in.** Transcript-Grades, Student Progress,
   Cert-Transcript-Requests, Staff Clock-in, School Fee and the MegaData pages now take the viewer
   from the signed-in dashboard session. Opened directly with no session, they show
   "sign in first". The web address can only narrow what they show, never widen it.
5. **Certificate verification for employers.** Create the Centre's signing key once, back it up,
   and publish its public half (`docs/CERTIFICATE-SIGNING.md`). Until then, certificates verify
   the old way.
6. **Video classes.**
   - The free public relay servers the old code used no longer exist.
   - If trainees on mobile data cannot connect, add a relay (TURN) server in Settings →
     Video Conference. Nothing paid is required by the code.
   - The *Large Class* option should point at a Jitsi server the Centre controls. The public
     meet.jit.si no longer allows long embedded meetings.
7. **E-mail (EmailJS).**
   - In the EmailJS dashboard, restrict the allowed origin and set a daily cap (see
     `LONGEVITY-AUDIT.md`).
   - For the Support form to deliver online, create a support template and set its id
     (`systemSettings.supportEmailTemplateId`). Until then the form offers an e-mail link instead
     of claiming "sent".
8. **Two decisions only the Centre can make:**
   - **Core/Elective column.** The official transcript's *Core/Elective* column now prints
     Core/Elective. It used to print the assessment date. Confirm this matches the approved
     paper layout.
   - **Automatic NYC.** The course-end "Not Yet Competent" status still ignores transcript
     results. Decide whether it should consider them.

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
  - The last 40 versions of every data file are kept in `data/.history`.
  - It tells a missing file apart from one it could not read.
- **Offline gates.** The Cashbook and certificate downloads work offline, with the Centre's
  server acting as the central store.

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
  npm test                     # every Node suite
  npm run test:syntax          # every JS file parses
  npm run build:offline        # regenerate the Offline System (a test fails if you forget)
  NODE_PATH=/opt/node-tools/node_modules npm run test:browser   # and the other test:browser:* suites
  ```
- **Never hand-edit a generated file in `Offline System/`.** Change the root file and regenerate.
  Only the server, signalling, store, certificate, launcher and README files there are
  maintained by hand.
- **When a shared library changes** (`cestis-core.js`, `cestis-page-cloud.js`), bump its `?v=`
  on every page so browsers fetch the new copy. The service worker always tries the network
  first.
- **New pure logic belongs in `cestis-core.js`** with a Node test, called from the pages. This is
  the pattern the whole upgrade follows.
- **Certificate signing key:** keep the backup somewhere safe and off the website. Never commit
  it. `.gitignore` already refuses `*signing-key-PRIVATE*.json`.

---

## Known limits, stated plainly

These need a real server, or a decision by the Centre. They are documented, not hidden.

- **Every signed-in device holds the whole Centre dataset.** Access control is enforced in the
  browser. A determined trainee with developer tools can read other people's records on their
  own device. Answer keys travel to trainee devices too: they are no longer in the trainee's
  attempt, and correct answers are not shown until released. The full fix is role-scoped reads
  through the MegaData broker (DECISIONS D6).
- **The Offline System's access key** can be fetched by any device on the Centre network.
  Real per-user sessions on the local server are the next step.
- **Video and chat identity** rest on room codes and connection ids. A trainee who knows a room
  code can still interfere online. On the Centre network the server can enforce host
  credentials.
- **Files shared publicly by the old code** keep their public links. Nothing was revoked
  automatically.
- **Clocks.** A device whose clock is wrong by more than a day, with no way to reach Google or
  the Centre server, still has its clock trusted for its own view.

---

## Recommendations

### UI improvements not yet made (in priority order)

The UI audit made 159 recommendations, and the ones that could be made safely without touching
data are done. These are the ones still open, most valuable first.

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

1. **Role-scoped data (the biggest remaining gap).** Have the MegaData broker (already built and
   in shadow mode) serve each device only what its role may see. It closes the "every device
   holds everything" limit, keeps answer keys off trainee devices and enables staff-side
   marking. The architecture is in `docs/02-MEGADATA-ARCHITECTURE.md`; cut-over is
   `docs/04-BOOTSTRAP-AND-CUTOVER.md`.
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
