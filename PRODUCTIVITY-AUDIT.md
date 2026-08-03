# CESTIS Train — Productivity Audit

*Audited 2026-08-03, on branch `claude/school-fee-performance-search-oadb5a`.*

**The question this audit answers:** where does the platform waste the user's
time — main-thread work that makes pages drag, timers that burn while nobody is
doing anything, scans that grow quadratically with the Centre's data, and
interruptions that break a clerk's flow.

**Method.** Every page was profiled in a real Chromium with seeded data at
realistic volumes (800 trainees, 6,000 attendance rows, 4,000 exam results,
3,000 chat messages, 2,000 payments); three code sweeps covered every large
file for seven anti-patterns (heavy timers, storage reads in loops, O(n²)
scans, row-at-a-time DOM, unthrottled keystroke handlers, undebounced storage
listeners, whole-store serialisation). ~60 findings were verified; the
high-impact, low-risk ones are FIXED in this branch, the rest are documented
below as a ranked backlog. The full test suite (2,400+ assertions) passes.

---

## Headline measurements

| What a user feels | Before | After |
|---|---|---|
| Dashboard idle while connected (24s) | 16 full re-renders | **0** |
| Keystroke in Student Progress search (1,200 records) | 538 ms | **0.2 ms** |
| School Fee refresh after recording a payment | 865 ms | **115 ms** |
| `saveState()` (main dashboard, 1,200+1,200 records) | 647 ms | **14 ms** |
| Recording 70 payments | 70 blocking OK dialogs | **0** (toast) |
| Cold load, every page (500 trainees seeded) | — | **130–600 ms, 0 long tasks, 0 errors** |

---

## Fixed in this audit pass

### A. Timers that burned while idle
Every page ran an always-on timer that re-serialised its whole store — and in
three cases uploaded it — whether or not anything had changed. `CESTISStore`
now counts its writes, and each tick compares one integer; an idle tick costs
nothing. Pulls (cloud → local) still run every tick, so cross-device changes
keep arriving.

- **LMS Chat 3.5 s poll** (`index.html`): merged and re-serialised the entire
  chat history per tick and rebuilt room membership (rooms × accounts ×
  centres) per tick, forever, even in hidden tabs. Now: saves only when the
  merge changed something, membership at most every 30 s, quarter-speed while
  the tab is hidden, and the cloud×local message merge uses a Set instead of
  `indexOf` per message.
- **Cashbook 15 s sync** (`CESTIS.Cashbook.html`): rebuilt the full multi-quarter
  backup, pretty-printed it (~⅓ size inflation) and re-uploaded it four times a
  minute. Now write-gated, compact JSON.
- **Virement 15 s autosave** (`Virement.Request.html`): re-parsed, deduped and
  re-wrote the whole request history plus a mirror of every cashbook quarter
  per tick. Now write-gated (the cheap form-draft capture still runs every
  tick, since drafts live in the form, not the store).
- **Payslip 15 s autosave** (`Staff.Payslip.html`): 3–5 whole-store
  `JSON.stringify` calls per tick as a change detector. Now write-gated, with a
  storage-event flag so another tab's payroll writes still trigger the merge.
- **Clock-in 10 s autosave** (`Staff.Clock.in.html`): stringified the entire
  time-record history every 10 s even with nobody clocked in. Now writes only
  while a session is active.
- **Main dashboard 5 s autosave + reactive refresh** (fixed earlier in this
  branch): same disease, same cure; refresh throttled to one pass/second and
  paused while hidden.

### B. Per-keystroke rebuilds
- **Staff appraisals roster search** (`staff-appraisals.js`): each keystroke did
  5 + one-per-row storage parses of the whole payroll store and rebuilt the
  table. The payroll parse is now memoised (1 s) and the search debounced.
- **Cashbook**: all five search boxes (transactions, void/unvoid cheque,
  budget-line pages) debounced 150 ms; the budget-line search had run a full
  `calcTotals()` pass per character.
- **School Fee / Student Progress searches** (fixed earlier in this branch):
  debounced, matching pre-stamped `data-search` strings.

### C. Quadratic scans on growing collections
- `renderCerts`: `students.indexOf` per certified row + a template-key scan per
  row → position map + memo (`index.html`).
- `renderExams`: full `examResults` scan per exam row, twice per refresh →
  one bucketing pass (`index.html`). *(Instructor/student exam views remain —
  see backlog.)*
- `renderInstructorAttendance`: `students.find` plus a centre resolution per
  attendance record → id map + per-course memo (`index.html`).
- `updatePipelineCounts`: seven full roster passes → one tally pass
  (`index.html`).
- Cloud-merge tombstone checks: two real localStorage reads + parses **per
  cloud student** → 1 s memo, invalidated on write (`index.html`).
- `dedupeAttendanceRecords`: ran its full sweep at the top of both attendance
  renderers every refresh → at most once per 5 s (`index.html`).
- Virement request lists: `virementRequests.indexOf` per row over the
  all-time history → position maps (`Virement.Request.html`).
- Earlier in this branch: the two student mirrors (LMS↔fee) went from
  roster×roll scans per keystroke to indexed lookups; centre cards, transfer
  page and enrolment registers now share one tally.

### D. A crash that killed page init
`renderFeeStructure` threw on any fee entry without a `terms` array — and it
runs during School Fee's init, so one malformed entry left the quarter bar and
everything wired after it dead. Now defensive (`School.Fee.html`).

### E. Flow interruptions
Recording a payment, adding a trainee and saving a trainee edit each ended in a
blocking `alert()` — one OK click per action, ~70 per busy quarter for payments
alone. All three are now non-blocking toasts. Errors and confirmations still
use dialogs deliberately. *(453 alerts remain across the platform — see
backlog for the next-worst offenders.)*

---

## Recommended backlog (verified, not yet fixed)

Ranked by (how fast the underlying data grows) × (how often the path runs).
Locations are exact as of this commit.

### High
1. **Payslip 60 s cloud tick** — `Staff.Payslip.html:1658→3900`: full Drive
   download + nested merge + dashboard re-render + pretty-printed upload every
   minute. Apply the same write-gate + compact JSON as the 15 s tick, and skip
   `renderDashboard()` when nothing changed.
2. **Payslip merge loops** — `Staff.Payslip.html:1429/1491/1527` (runs² ×
   results², on the 15 s tick when dirty) and `:1829` (`refreshAllData`
   triple-nests runs × results × `employees.find` while ignoring the lookup map
   built 20 lines above). Build name→employee maps once.
3. **Cashbook `refreshAll()`** — `CESTIS.Cashbook.html:5649`: 14 renderers,
   ~7 independent `calcTotals()` full passes, called from 25 sites including
   the sync timer. Render only the visible page; pass one `calcTotals()`
   result down.
4. **Cashbook reconciliation** — `:7081/7441`: ~40 storage reads + 16
   whole-quarter parses per render, re-rendered on every checkbox tick; the
   prior-quarter loop at `:7458` parses data and discards the result. Cache the
   parsed quarters for the render pass.
5. **Cashbook report matrix** — `:5926`: transactions × budget-categories
   `<td>`s inside `refreshAll()`. Bucket payments by category first.
6. **Clock-in merge/compare loops** — `Staff.Clock.in.html:3506/3996/5266`:
   local×cloud scans with `JSON.stringify` equality per pair, on the silent
   sync path. Index by id; compare `lastModified` stamps instead of
   serialising.
7. **Payslip cashbook-name dropdown** — `Staff.Payslip.html:2549`: parses every
   `cestis_quarter_*` blob (unbounded growth) on every Payslips-page visit and
   every employee change. Cache per session; invalidate on quarter writes.
8. **PDF Workshop editor** — `PDF.Workshop.html:2062` (undo history deep-clones
   every annotation + every freehand point per edit, 50 snapshots retained) and
   `:2192/2291` (full annotation-layer rebuild + full path replay per
   mousemove). Snapshot per-page, not per-document; move drag updates to
   transform instead of rebuild.

### Medium
9. **`renderCertDownloadMgmt` + `reconcileCertifiedFromApprovals`** —
   `index.html:37429+/35918`: three approvals×students scans, twice per
   refresh, and they *write* student records from inside the render funnel.
   Index approvals by studentId; move reconciliation out of render.
10. **Instructor/student exam views** — `index.html:21182/11221`: same
    per-row `examResults` scan just fixed in the admin view.
11. **Chat message renderer** — `index.html:28689`: `userAccounts.find` per
    message and a DOM element allocated per escaped string. Index accounts;
    use a string-replace escaper.
12. **`lmsChatOpenRoom`** — `index.html:28597`: rewrites the whole chat store
    on every room click (`saveLmsChatData` deep-clones every message).
    Save only the opened room's read-marks, debounced.
13. **`reconcileStudentsFromAccounts`** — `index.html:7166`: up to two
    tombstone parses per account (the 1 s memo added in this pass now blunts
    it; indexing accounts by studentDataId would finish the job).
14. **`getCourseList()`** — reads + parses the centre tombstones per call;
    several calls per refresh. Route through a short memo like the other
    catalogue reads.
15. **Clock-in report/admin tables** — `Staff.Clock.in.html:7364/7133`:
    `insertRow` per record over the full history, with a `findIndex` per row in
    the admin editor. Build one HTML string; use a position map.
16. **`innerHTML +=` option builders** — `Staff.Payslip.html:2461/2667/3247`,
    `index.html:36901`: quadratic select rebuilding as payroll runs accumulate.
17. **Blocking dialogs on remaining hot paths** — 453 `alert()`s platform-wide.
    Worst clusters: Cashbook transaction actions, index.html student/user
    management. Convert success-confirmations to toasts page by page.

### Low (worth doing opportunistically)
- Pretty-printed uploads elsewhere (`Staff.Clock.in.html:3095` etc.) — compact.
- `renderCalendarEventList` sorts the shared array in place per render.
- `notifications` interactions rebuild the dropdown twice per click.
- Payslip 5 s permission poll re-parses the store to detect an expiry a single
  timestamp comparison would catch.

### Structural notes
- **`CESTISStore.getItem` reads through to localStorage on every call** by
  design (cross-document coherence). Fine for keys read occasionally; any code
  reading it inside a loop must memoise per pass — the pattern now used
  in School Fee, the catalogue, the tombstone checks and the appraisals page.
- **Unbounded growth**: `cestis_quarter_*` blobs, payroll runs, virement
  history, `timeRecords` and `examResults` are never archived. Nothing needs
  pruning yet at current volumes, but every backlog item above gets worse
  linearly with them; an FY-end archival pass would cap the whole class.
- **Capped already**: notifications (50), chat messages (per-room cap).

---

## How this was verified

- `tests/` — 2,400+ assertions including the perf-equivalence suites
  (`school-fee-perf`, `twin-index`, `centre-counts`, `centre-key-identity`,
  `no-data-loss`, `shared-cloud-read`): the fast paths return byte-identical
  results to the code they replaced.
- Browser measurements in Chromium (Playwright): cold loads, idle long-task
  observation with the PerformanceObserver, before/after medians of 7–9 runs
  per interaction on seeded rolls up to 1,200 records.
- Every page loads with zero page errors after the changes.
