# Running the Centre — what to do, and when

One page for the Centre's owner. No technical knowledge is needed for the regular jobs. Where a
job needs the person who maintains the system (the *maintainer*), it says so.

The system costs nothing to run. The Centre's records are kept on each staff computer and copied
to the Centre's own Google account (Google Drive, 15 GB free, shared with its Gmail). The screens
never say where things are kept; this page does, so that you know.

---

## Every day

- **Keep one office computer signed in during opening hours,** with the dashboard open and the
  sync control (top right) saying **All saved**. That computer does the background work for
  everyone: it sends trainees their records and tests, collects what trainees send from home,
  keeps the whole-Centre backup fresh and makes the weekly backup.
- **Before closing:** check each office computer says **All saved**, then **Sign Out**. Signing out
  sends the last copies. A computer that says *Changes waiting* or *Storage is full* keeps its work
  safely until it can send it — do not clear that browser's data.
- **If a small "Reconnect" button appears** beside the sync control, press it. The sync sign-in
  lasts about an hour and renews itself; when the browser blocks that, one press renews it. Work
  is kept on the computer meanwhile.

## Every week (Monday, five minutes)

- Sign in as the **Administrator** and look at **System health** on the dashboard. Each line is
  green (*Good*), amber (*Check*) or red (*Act now*), with one line saying what to do:
  - **Weekly backup** — one is made by itself each week; the last 12 are kept.
  - **Whole-Centre backup** — when it was last saved, and how many trainees and records it holds.
  - **Trainee sign-in** — whether trainees can sign in from home, and whether their records are
    up to date.
  - **Storage** — how full the Centre's account is (a warning from 80%).
  - **Staff computers** — when each one last saved; a computer silent for more than 7 days is named.
  - **Exported copy** — when a copy was last exported by hand.
- All green: nothing to do. Amber or red: do what the line says. The bell (🔔) also tells you, at
  most once a day, if trainee sign-in needs attention.
- Open **Assessment Results** and set *Result* to *Awaiting marking*. Ask the instructor to mark
  anything still waiting (an essay, a short answer, a group practical). Each record is filed in the
  Assessment Results folder by itself; when it is marked, the marked copy replaces it.

## Every month

- **Export a copy to a USB stick.** Settings → **Data Management** → **Export Backup** (or press
  Ctrl+Shift+E). Copy the downloaded `CESTIS_Backup_<date>.json` to a USB stick. Keep at least the
  last three months, and keep one stick away from the Centre. This copy does not depend on Google
  at all. The health card turns amber after 30 days without one.

## Every term

- **Clear out old class recordings.** Recordings are the biggest thing in storage (about a quarter
  of a gigabyte per recorded hour). In the Centre's Google Drive, open the **Class Recording** folder, download
  any recording you must keep to a USB stick or an external drive, then delete the old ones.
- **Empty the Drive trash** afterwards (deleted files keep using space for 30 days until then).
  Large Gmail attachments use the same 15 GB.
- Glance at the **Storage** line again. If it stays above 80% after this, ask the maintainer.

## Every year

- **Academic year:** at the start of each academic year, Settings → **System Settings** →
  **Academic Year**. If the new year is not in the list yet, ask the maintainer to add it.
- **Certificate signing keys:** after a certificate is withdrawn, or a new signing key is made, the
  maintainer publishes `cert-keys.json` (see `docs/CERTIFICATE-SIGNING.md`). Keep the private key's
  backup on its USB stick in the safe.
- **Payroll rates:** when the statutory rates (NIS, NHT, Education Tax, PAYE threshold) change, the
  maintainer updates the payroll rates file the Payslip page reads.
- **Outside accounts still active:** the video relay (TURN) and Large Class (Jitsi) accounts, if the
  Centre uses them (Settings → **System Settings** → *Relay servers* and the Large Class address),
  and the **EmailJS** account that sends e-mails
  (allowed website and daily cap set, templates still there).
- **Security check-up of the Centre's Google account:** both owners can still sign in, 2-Step
  Verification phones are current, recovery phone and e-mail are right.
- **Practise a restore:** open the sync control → **Restore from a Weekly Backup**, pick a week and
  look at the preview, then press **Cancel**. Nothing is changed; you have checked the backups read.

---

## When something goes wrong

**Nothing is ever lost by these steps.** Restores only ever *add back* what is missing; they never
overwrite newer work and never bring back something deleted on purpose.

### An office computer is lost, stolen or broken
- On any other computer (or a new one), open the dashboard, press **Turn On Sync**, sign in with
  the Centre's Google account, then sign in to the dashboard. Everything comes back to it.
- Anything that computer had not sent yet (it would have said *Changes waiting*) is lost with it —
  which is why each computer should say **All saved** before closing.
- If it was stolen: change the dashboard passwords of the people who used it, and in the Centre's
  Google account (Security → Your devices) sign that computer out.

### The Centre's Google account is lost (password forgotten, account locked)
- Use Google's account recovery with the **recovery phone** or **second owner** (see *Who owns
  what*). Once back in, nothing else changes.
- If it is lost for good: the records are still on every staff computer and on the monthly USB
  copy. Do **not** clear any staff computer's browser. The maintainer then needs about one to three
  days: a new account, new folders, the folder and sign-in settings changed in the site's files, the
  trainee sign-in program set up again (it gets a new address, so the QR code must be printed and
  shared again), and the records loaded back from a staff computer or the USB copy.

### A folder was deleted in Google Drive
- Restore it from Drive's **Trash** within 30 days: Drive → Trash → right-click → **Restore**. It
  comes back with the same identity, and everything carries on. (The system never makes a missing
  folder again by itself — a new folder would not be the one it looks for.)
- Never empty the trash while a Centre folder is in it. If it is already gone for good, the records
  are still on the staff computers; ask the maintainer.

### A bad change is discovered later (records missing, a list emptied)
- Sync control → **Restore from a Weekly Backup** → pick the week before the problem → the preview
  shows exactly what it would add back (for example "2 trainees, 14 attendance marks") → **Add**.
- It adds back only what this computer no longer has. It never undoes newer work and never brings
  back what was deleted on purpose.
- A record that was *changed* wrongly (rather than removed) is put right by hand: the weekly backup
  file in the Drive folder **Backups** shows what it said that week (ask the maintainer to read it).
- For the last few hours: Sync control → **Restore from Master Backup** does the same from the
  whole-Centre backup.

### Trainee sign-in stops working
- Signs: the health card's **Trainee sign-in** line turns red, the bell says so, or trainees call.
- Settings → **Trainee Sign-in from Anywhere** → press **Check**, then press the buttons under
  **Checks after setup**. Each says what is wrong and what to do.
- Trainees lose nothing: what they do at home waits on their phone and is sent when it works again.
- If it cannot be fixed the same day, tell the maintainer, with what the checks said. The setup
  sheet (`trainee-gate/SETUP.md`) has everything, including how to turn it off.

### "Storage is full"
- Everyone's sync control says **Storage is full — tell the administrator**. Their work is kept on
  their computers and sent by itself once there is room.
- Do the term's clear-out now (old class recordings, then empty the trash). Saving restarts within
  a few minutes.

---

## Who owns what

| What | Who should hold it | Notes |
|---|---|---|
| **The Centre's Google account** (records, Gmail, the trainee sign-in program) | Two people: the owner and a deputy | 2-Step Verification on, with two phones; recovery phone and recovery e-mail set; backup codes printed and kept in the safe. |
| **The Google Cloud sign-in project** (the "client" the sync sign-in uses) | The Centre's account, plus the deputy as a second owner | Its **OAuth consent screen must say "In production", not "Testing"**: in Testing, sign-ins stop working after 7 days. Check once: console.cloud.google.com → APIs & Services → OAuth consent screen → *Publishing status*. |
| **The website's code** (GitHub repository) | The owner and the maintainer | The site is published from it (GitHub Pages). Nothing secret is ever kept there. |
| **EmailJS account** | The Centre's account | Allowed website and daily cap set. |
| **Video relay / Jitsi accounts** (if used) | The Centre's account | Free plans can expire: check yearly. |
| **Certificate signing key backup** | USB stick in the safe | Never e-mailed, never in Drive, never on GitHub. |
| **The monthly USB copies** | The owner | One stick kept away from the Centre. |

## Where to find more

- What changed in the October 2026 upgrade, and its known limits: `docs/UPGRADE-2026-10.md`.
- Trainee sign-in setup and its checks: `trainee-gate/SETUP.md`.
- Certificate signing: `docs/CERTIFICATE-SIGNING.md`.
- The Centre's own network (Offline System): `Offline System/READ ME FIRST.txt` — it keeps the last
  40 versions of every file and one copy a week for 12 weeks.
