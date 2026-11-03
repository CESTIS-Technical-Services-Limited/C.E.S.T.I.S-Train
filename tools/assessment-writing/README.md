# Writing prepared assessment banks

These are the tools and notes used to write the question banks in `assessments/`. The writers worked to `BRIEF.md`, which sets the rules for every bank: format, Level 2 and Level 3 language, safety, Jamaican facts, and how the practicals work.

- `check.js <bank.json> ...` checks a bank before it goes into `assessments/`. It runs the system's own `checkBank`, then the house rules:
  - unit and qualification names exactly as the Centre lists them;
  - right answers spread over a–d;
  - the right option not usually the longest or the shortest, and at one of those ends in at least 9 questions;
  - no repeated questions;
  - the expected marks, times and counts;
  - no pass mark in the file;
  - Jamaica's 50 Hz supply.
- `batches.json` lists the units in writing batches. `worklist-l2-core.json` lists the qualifications.
- `copy-shared.js <QUAL-ID>` files a unit shared by several programmes under each of them, with that programme's names. It reads `out/`, the writers' output folder.
- `notes/` holds each programme's instructor check list, the source of `assessments/<programme>/CHECK-LIST.md`.
- `work-in-progress/` holds banks written for a programme that is not finished yet. They move into `assessments/` when the whole programme is done and checked.
