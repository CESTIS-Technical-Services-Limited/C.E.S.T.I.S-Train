# Phase 0 — Ground-Truth Inventory

**Method:** every file in the repository was read (grep-guided for the multi-hundred-KB pages), by eight parallel readers plus direct verification of cross-cutting claims. The two prior audit documents (`LONGEVITY-AUDIT.md`, `PRODUCTIVITY-AUDIT.md`) were treated as hypotheses and verified against code; §12 lists where they are wrong or stale. Line references are to the working tree as of 2026-08-05. No code was changed in this phase.

**Scale measured from the committed fixture and seeds:** 368 fee-roll trainees (249 unpriced at fixture time), 130 payments in the fixture, programme mix COSMETOLOGY L2 ×136 / WELDING L2 ×86 / ELECTRICAL L2 ×65 / PV Installer ×52; fees J$15k–48k per programme; cashbook quarter seeded with real salary runs ~J$70k–107k/month/staff. Currency is Jamaican dollars by context; **no currency code appears anywhere in the code, and all money is IEEE-754 floats.**

---

## 1. Page / module map

### 1.1 Root applications (each a separate self-contained app sharing one origin + one IndexedDB)

| App | Size | Purpose |
|---|---|---|
| `index.html` | 46,534 ln | Main LMS: login/2FA, students, training centres, enrolment, transfer, attendance, exams + import wizard, certificates + downloads, transcripts hub, reports, chat, video conferencing, calendar, announcements, notifications, support, settings/user-management, admin duties, appraisals mount, CMC board portal, document hub, **embedded second copy of the time-clock app** (:40347–46290), **LMS↔fee mirror wrapper** (:46293–46531), Drive sync engine |
| `School.Fee.html` | 14,740 ln | Fee app: fee structure per programme, student roll, payments, receipts (PDF), documents (Drive-stored), reports, Excel import/export, own users + 2FA/OTP (login bypassed when embedded), **two independent Drive sync systems**, LMS mirror |
| `CESTIS.Cashbook.html` | 9,043 ln | Quarterly cashbook: transactions, cheques + void/unvoid, budgets, subvention, monthly bank reconciliation, reports, financial form, own login, Drive sync ×2, **writes into the payslip app's store** |
| `Virement.Request.html` | ~5,600 ln | Budget-transfer requests + admin-PIN approval; persisted mirror of cashbook budget/actuals; Drive sync ×2 |
| `Staff.Payslip.html` | 6,592 ln | Payroll: employees, monthly runs (Jamaican statutory calc), payslips, SO1 export, salary records, own users + 2FA/OTP, permission system, Drive sync ×2 |
| `Staff.Clock.in.html` | 8,484 ln | Time clock: staff DB (with embedded base64 PDF documents), clock in/out/breaks, admin record editor, reports, per-user Drive files + page-cloud sync |
| `Payments.Invoices.html` | 7 KB | Finance-docs hub page (live counts; registers a 4th page-cloud owner of the finance keys) |
| `Finance.Invoice/Quote/Purchase.Order.html` | ~2.4 KB ea | Thin shells over `finance-docs.js` |
| `Finance.Payment.Voucher.html` | 31 KB | Payment vouchers derived on the fly from cashbook quarters + per-voucher edit overrides; bespoke Drive pull/push |
| `Student-Progress.html` | 1,322 ln | Iframed roster CRUD on the shared LMS student list; pipeline stages; dedupe/stable-id migration; CSV export |
| `Transcript-Grades.html` | 1,224 ln | Iframed transcripts: manual grades + live-exam resolution, official transcript/grade-sheet PDF, unit catalogues |
| `Cert-Transcript-Requests.html` | 245 ln | Iframed request queue (pending→processing→ready→collected/declined) |
| `Qual-Plan-Curriculum.html` | 709 ln | Drive-only qualification-plan browser (no local storage at all) |
| `PDF.Workshop.html` | 170 KB | PDF merge/split/OCR tool — persists nothing |
| `LMS-Chat*.html`, `Video-Conference*.html` | small | Markup-only fragments consumed by index.html (chat/VC logic lives in index.html) |
| `Pages/*.html` (31 files) | ~80 KB | UI fragments fetched at runtime and injected via `innerHTML` (registry `index.html:10140`, loader :10467). 9 pure-markup; **20 carry 109 inline event handlers** binding to index.html globals; 3 inject document-wide `<style>` blocks |
| Shared JS | | `cestis-core.js` (5,136 ln: CESTISStore + all shared domain logic), `cestis-page-cloud.js` (442 ln: per-page Drive sync), `cmc-portal.js` (render-only board portal), `finance-docs.js` (invoice/quote/PO engine), `finance-logos.js`, `staff-appraisals.js` (2,084 ln), `cert-template-seed.js` (data), `transcript-assets.js` (base64 assets only) |
| `vendor/` | | All libraries local + pinned with CDN fallbacks. **Version skew is page-scoped:** Chart.js 3.9.1 (School.Fee) vs 4.4.1 (index, Cashbook); EmailJS 3 (School.Fee) vs 4 (index, Clock-in, Payslip); OTPAuth 9.2.1 (Payslip) vs 9.2.2 (index, School.Fee) |
| `tests/` | 34 files | 2,400+ assertions, no framework; several tests execute code **scraped out of index.html source text at test time** |

### 1.2 `Offline System/` — a second copy of the whole platform

Full duplicate of every app plus: `cestis-offline-server.js` (local HTTPS server serving the LAN), signalling/RTC/cert helpers, START-{WINDOWS,MAC,LINUX} launchers, `data/` directory replacing Google Drive, its own package.json/tests/User Login. Confirmed drift: offline `cestis-core.js` differs by ~1,425 diff lines, `cestis-page-cloud.js` by ~363 (Drive → local-server endpoints + `CESTIS_ALL_DATA.json` catch-all), `School.Fee.html` is ~1,270 lines behind root (missing the intake-collapse, keep-separate, perf-cache and crash-guard fixes), `Student-Progress.html` behind root; `Pages/`, `cmc-portal.js`, `Qual-Plan-Curriculum.html`, `cert-template-seed.js`, `transcript-assets.js` identical. `data/` contains only its README (no committed data). Full drift table: §13.

---

## 2. Data map — where every record lives

**One storage engine:** `CESTISStore` (cestis-core.js:42–146) = in-memory cache + localStorage mirror + IndexedDB `CESTIS_KV`/store `kv`, same origin for every app. `getItem` reads localStorage first, then cache (deliberate iframe coherence; consequence: a stale localStorage value silently beats a newer IndexedDB value). Values too large for localStorage exist only in cache+IDB and are **invisible to other open tabs until reload** (no storage event fires for them). `navigator.storage.persist()` requested at load. Write failures surface via `cestis-store-write-error` events. Inline duplicate CESTISStore definitions in Student-Progress, School.Fee, Cashbook, Payslip, Clock-in are dead code (core loads first and wins).

### 2.1 Storage-key registry (exact keys, owner → other writers/readers)

**LMS (`voctrain_` namespace, owner index.html unless noted):** `voctrain_students` (also **written** by School.Fee :5986/:6022/:7119/:6118, Student-Progress :586–603), `voctrain_users` (accounts; PBKDF2 or legacy SHA-256), `voctrain_userAccounts` (**phantom — read at index:18293, never written anywhere**), `voctrain_attendance` + per-quarter `voctrain_attendance::<FY>_Q<n>` + `voctrain_attendance_quartered`, `voctrain_exams`, `voctrain_examResults` (also written by Transcript-Grades :853–864), `voctrain_announcements`, `voctrain_calendarEvents`, `voctrain_classSessions`, `voctrain_adminMeetings`, `voctrain_assignments`, `voctrain_submissions`, `voctrain_resources`, `voctrain_driveResources`, `voctrain_instructorProfiles`, `voctrain_instructorData`, `voctrain_studentProfiles`, `voctrain_certDownloadApprovals`, `voctrain_certTemplates` (+ separate image store) , `voctrain_certTemplateCourseMap`, `voctrain_chatRooms/chatMessages/chatProfiles/chatFollows` (caps: 500 msgs/room), `voctrain_user_<id>_*` per-user copies, `voctrain_notifications` (cap 50), `voctrain_support_messages`, `voctrain_systemSettings`, `voctrain_adminStaffAccess`, `voctrain_maintenanceMode`, `voctrain_adrTasks/adrStaffMeta`, `voctrain_vcSessions`, `voctrain_examInProgress`, `voctrain_sessionExpiry/Role/UserId`, `voctrain_dataVersion`, tombstones `voctrain_deletedStudentIds` / `voctrain_deletedCentreIds`, `voctrain_skillAreas` (centre catalogue), transcript keys `voctrain_unitCatalogs / transcriptGrades / transcriptProfiles / certTranscriptRequests` (owner: the transcript iframes).

**Fees (`cesti*` namespace, owner School.Fee.html):** `cestiSchoolFeeStudents` (also written by index.html mirror :46402/:46495 and Student-Progress :990–1021), `cestiSchoolFeePayments` (also index :20208), `cestiSchoolFeeDocuments`, `cestiFeeStructure` (`{programmeName: {total, terms[9]}}` — **keyed by programme name string**), tombstones `cestiSchoolFeeDeletedLmsIds` / `cestiSchoolFeeDeletedPaymentIds`, users `cestiUsers`.

**Cashbook/finance:** per-quarter blobs `cestis_quarter_<FY>_Q<q>` (`{openingBalance, transactions[], deletedTxnIds[]}`; also **written** by Finance.Payment.Voucher cloud pull PV:196–212 and read by Virement/Payslip/Payments hub), `cestis_budget_<FY>_Q<q>`, `cestis_active_quarter` (shared view state written by Cashbook, Virement, Payment Voucher, School.Fee), reconciliation keys `cestis_recon_{bank,uncleared,depnotshown}_<FY>_Q<q>_<mon>`, logos, legacy `cesti_cashbook_data`, `cestis_budget_overrides/deleted` (legacy), `cestis_auth_session`. Finance docs: `cestis_finance_invoices/quotes/pos` (owner finance-docs.js), `cestis_finance_convert` (quote→invoice baton), `cestis_finance_voucher_overrides`. Virement: `cesti_virements`, `cesti_virement_deleted_ids`, `cesti_virement_form_draft` (rewritten every 15 s), **`cesti_virement_cloud_cache` (a persisted copy of cashbook budget+transactions per quarter)**, `cesti_virement_logo`.

**Staff:** `cestisStaffMembers` (owner Clock-in; also RW by index.html ttc block :42975–43006, read by appraisals), `cestisTimeRecords` (same double ownership), `cestisCurrentUser` (**auto-set to first Admin without authentication**, Clock-in :8392–8398), `cestisPayroll` (owner Payslip; **also written by Cashbook** :5158–5272), `cestisPayroll_backup`, `cestisDataHighWater`, `dashboardUsers` (Payslip users; TOTP secrets + backup codes stored in plaintext), `cestisPermissions`, `cestisStaffAppraisals` (owner staff-appraisals.js).

**Sync state:** two independent Google token stores — `schoolDashboardGoogleAccessToken/-TokenExpiry` (index.html + page-cloud + Payment Voucher + Payslip legacy) and `cestisGoogleAccessToken/-TokenExpiry` (School.Fee legacy, Cashbook, Virement, Clock-in, index ttc block); assorted `*CloudFileId`, `*LastSyncTime`, per-file stamp maps `cestis_pagecloud_stamps__<file>`.

### 2.2 Cloud artifact map (Google Drive; OAuth client id committed, scope = full `drive`)

| Drive file | Folder | Writer / cadence | Merge discipline |
|---|---|---|---|
| `CESTIS_LMS_BACKUP.json` | main `1lNpI00Et…` **+ 4 more folders** (exams, chat, recordings, assignments) | index.html, 5 s write-gated autosave | main folder: version-gated pull-before-write (`pullMainIfRemoteNewer` :27729) then merge; **other 4 folders last-writer-wins** |
| `cestis-master-snapshot.json` | `1-BVqRHL3bh0UB30pvlXt0AWAsKWsueec` | index.html on demand/login | checksum-verified snapshot; add-only reconcile (`reconcileSnapshot`), tombstone union, rescue reporting |
| Page-cloud files (14): `CESTIS_Student_Progress / School_Fees / Transcript_Grades / Transcript_Requests / Cashbook / Virement_Requests / Finance_Invoices / Finance_Quotes / Finance_PurchaseOrders / Payments_Invoices / Payment_Vouchers / Staff_Payslips / Staff_TimeClock / …json` | **`11vWe_Nc40TtJ1Hi7PoE7EZ3JrpR-K0Vj`** | `cestis-page-cloud.js`: pull at load, push 1.5 s debounce after any owned-key write, 60 s modifiedTime poll, pagehide flush | per-key newest-ISO-stamp wins; tombstone keys always unioned; **empty never beats non-empty in either direction**; first-sync cloud-wins |
| `school_fee_management_system.json` | same `11vWe_…` | School.Fee legacy engine, **15 s auto-sync** | union/add-by-id with **local-wins whole-record** (no timestamps); also destructive-replace and reviewed-merge manual paths; **uploads password hashes** |
| `CESTIS_CASHBOOK_DASHBOARD_BACKUP.json` | `1aL_QZiJ…` | Cashbook, 15 s (push write-gated; **pull every tick**) | silent merge: txns add-by-id + tombstones; **budgets only-if-absent**; no version check |
| `Cashbook_Virement_Backup.json` | `1G6ipD…` | Virement | add-by-id, approval-wins, deleted-ids union; refuses empty push |
| `CESTIS_Payment_Voucher_Overrides.json` | `1G6ipD…` | Payment Voucher, 1.2 s debounce | per-voucher LWW on `editedAt` |
| `employee_payroll_Backup.json` | `1JY8N-AX…` | Payslip legacy, **60 s unconditional** full download+merge+upload | name/date-keyed additive merge; users/permissions replace-on-restore |
| `Staff_Clock_In_System_<user>.json` (per user) + legacy | `11vWe_…` subfolder | Clock-in on clock events + 10 s local tick | download-merge (id + lastModified) then **upload filtered to current user only** |
| `CESTIS_LMS_CHAT.json`, `CESTIS_ASSIGNMENTS.json`, resources, per-user `CESTIS_USER_<role>_<id>.json`, `User Login/<account>/account.json` tree | chat/assignments/resources/per-user folders | index.html | various add/merge |
| Qual-plan folders (8 programme + 7 short-course) | read-only | Qual-Plan browser | n/a |

**Reconciliation with the MegaData spec's folder plan:** the spec's "legacy read-only" folder `11vWe_…` is **the platform's busiest live sync folder today** (14 page-cloud files + fee legacy + clock per-user files). The spec's "MegaData master store" folder `1-BVqRHL…` is **already occupied** by the live master-snapshot feature. The per-page folder `1ddRM6zgTAupsYZzU7z2vbYXZhNQ6qx4B` has zero references in code (genuinely fresh). Legacy data that the bootstrap must inventory spans **~12 Drive folders**, not one.

---

## 3. Entity map (shapes and their variants)

| Entity | Canonical-ish shape | Variant shapes (the divergence surface) |
|---|---|---|
| **Student** | LMS `voctrain_students`: `{id:'STU-<hash(name\|course)>', name, course, stage(testing/interview/training/certified/collected/nyc/incomplete), score, progress, attendance(scalar %), assignments(+Total), gpa(string), instructor, certNo/certDate/certCollected, email, phone, dob, address, trn, gender, nqfLevel, notes, enrollDate, createdAt, lastModified, centreId/centreKey/centreName/courseStart/courseEnd/enrolmentDate/fiscalYear, schoolFeeId?, lmsId?, keepSeparate?, source?}` | Fee twin `cestiSchoolFeeStudents`: same person as `{id, lmsId, name, skillArea, tuitionFee, contact(=phone), dateOfBirth(=dob), nationalId(=trn), parentName/parentContact/emergencyContact/city, **totalPaid, balance, status**, needsFeeDetails, updatedAt…}` (alias map core:442–450); Student-Progress edits the LMS shape; account link via `voctrain_users.studentDataId`; profile fragments in `voctrain_studentProfiles` **and** `voctrain_transcriptProfiles` (dob/address/idNo again); denormalised `studentName/course` copies inside payments, attendance rows, approvals, requests |
| **Account/user** | `voctrain_users` (LMS): PBKDF2 `pbkdf2$210000$salt$hash` (legacy SHA-256 tolerated), roles admin/adminstaff/cmc/instructor/student, status active/pending/disabled/rejected, 2FA fields, `updatedAt` | **Three more credential stores:** `cestiUsers` (School.Fee), `dashboardUsers` (Payslip; TOTP secret + backup codes plaintext), `cestisStaffMembers` (Clock-in + LMS ttc; doubles as staff HR record with embedded base64 PDF documents). `User Login/` folder contract documents SHA-256 while code uses PBKDF2 |
| **Fee structure** | `cestiFeeStructure[programmeName] = {total, terms[9]}` — identity is the programme **name string**; term split `Math.round(total/termCount)`, remainder on last term | Programme name also lives in: student.skillArea, payment.skillArea, centre label, LMS course — four normalisation passes (normalize/dedupe/bind/collapse) rewrite records at load to force convergence |
| **Payment** | `{id:'PAY'+Date.now(), studentId, studentName, skillArea, amount(float), date, method, term:'Term N', receiptNumber(manually typed, optional, no uniqueness), notes, createdAt}` — **mutable in place, no audit trail**; delete = splice + bare-id tombstone | Same payment shape copied into 4+ Drive artifacts; smart-merge force-add **regenerates ids** (same real payment can exist twice) |
| **Cashbook transaction** | `{id:int(seq from 100), date, cheque(free text), details(payee+purpose free text), deposit(float), payment(float), category}` — **no timestamps, no author**; void keeps `_orig*` fields, sets category 'Cancelled' | Salary txns copied into `cestisPayroll` as pseudo-results (gross=net, statutory zeroed); quarter copies inside Virement's persisted cache and 4 cloud files |
| **Budget** | per quarter `{budget:{category:float}, sections:{category:sectionName}}` | Virement renders allocations/actuals from its own persisted cache |
| **Virement request** | `{id:Date.now(), date, fy, quarter, project, period, requestedBy, position, total, totalWords, lines[{fromId,fromName,toId,toName,amount}], status Pending/Approved/Rejected, approvedBy?, approvalDate?}` | approvals never write back to any budget |
| **Finance doc** | `{id:'FD-…', docType, number(computed local max+1), template, date, parties, items[], discountPct/taxPct/depositPct, revisions[], createdAt/updatedAt}` — no tombstones | same keys owned by 2–4 page-cloud files |
| **Voucher** | never stored — derived from cashbook txns (core:4435); + `cestis_finance_voucher_overrides['FY\|Q\|txnId']` with `editedAt` | |
| **Payroll** | `cestisPayroll = {settings, employees[{name(=identity, no id), designation, type FT/PT, mobile, dob, trn, nis, startDate, salary}], payrollRuns[{date(month key), results[{empName, gross, nis*/edTax*/nht*/heart/incomeTax, totals, netPay, cashbookSynced?, cashbookTxns}]}]}` — floats; **two different calc formulas** (create :2262 unrounded vs edit :2360 rounded, different edTax base) | Cashbook-written results have statutory zeroed; YTD sums whatever ordering the array has |
| **Time record** | `{id:'SESSION_'+Date.now(), staffId, staffName, workType, date, clockIn/clockOut ISO, status, breaks[{start,end,duration}], lastModified}` — admin edits **don't bump lastModified** | per-user Drive slices vs whole-store page-cloud copy |
| **Attendance** | day-record `{studentId, studentName, course, date, days{Mon–Fri}}` + per-quarter bucket copies | vs `students[].attendance` manual % vs VC session minutes |
| **Exam / result** | exam `{id,title,course,date,time,duration,status,questionData[],passMark,passRate}`; result `{id:'RES-…', examId, studentId, answers[…], score, passed, needsReview…}` | manual transcript override **rewrites** `score/passed` in place (flagged `manualOverride`); `students[].score` and `gpa` are separate manual scalars |
| **Transcript grade** | `{id:'TG-'+hash(studentId\|qualId\|unitCode), grade, date, source manual/exam, examResultId, updatedBy/At}` — deterministic id (good) | grade-sheet pass mark hardcoded 60 vs per-exam passMark |
| **Certificate** | fact spread across `students[].stage/certNo/certDate/certCollected`, `voctrain_certDownloadApprovals` (`CDA-<studentId>`, one per student), `certTranscriptRequests` (unlinked workflow), templates keyed by course-name string | certNo minted two ways (`course.substring(0,2)+year+rand4` SP:916 vs `generateUniqueCertNo` index:36467); certDate en-US locale string vs DD/MM/YYYY elsewhere |
| **Chat / VC / calendar / announcements / notifications / assignments / resources / support** | shapes per index.html report §3 | chat stored 4 ways (global keys, per-user keys, chat Drive file, inside main backup) |
| **Centre / skillArea** | `{id, name, icon, color, students(count), materials, desc, centreKey, startDate/endDate, level, instructorPermissions[]}` — 20-entry seed duplicated in core and index.html and Qual-Plan fallback | |
| **Appraisal** | `{cycle, staffId('USR:'/'CLK:'/'PAY:'/'EXT:' prefixed — **source-dependent identity**), template, scores, status, signatures{}}` | |
| **Envelopes** | snapshot `{schemaVersion:1, counts, checksum, store}`; page-cloud `{version:'1.0', stamps, data}`; legacy backups `{version:'1.0'/'2.0', data:{…}}` | several bespoke backup payloads with different key coverage (§9) |

---

## 4. Divergence register

Severity: **C** = wrong money/credentials/records visible to users; **H** = same fact reliably disagrees across pages/devices; **M** = disagrees under specific sequences; **L** = cosmetic/view-state.

| # | Fact | Location A | Location B | Mechanism | Repro sketch | Sev |
|---|---|---|---|---|---|---|
| D1 | Student fee balance | stored `student.balance/totalPaid/status` (School.Fee, persisted + exported + mirrored + uploaded ×2) | recompute from `cestiSchoolFeePayments` (`recalculateStudentTotals` SF:6322) | balance is compute-then-persist; 8 incremental paths update it; recompute runs only on the device/page that refreshes; merges ship the stored number | record a payment on device A; view Excel export/master snapshot/device B before its dashboard refresh → old balance | **C** |
| D2 | "Total collected" | Fee dashboard: Σ scoped `payment.amount` (SF:8921) | Reports tab: Σ `student.totalPaid` whole roll (SF:9183/9284) | different source **and** different scope (quarter bar vs everything); orphaned payments split them permanently | delete/merge a student leaving orphan payments (D6), compare cards — code comments memorialise a J$29,000 gap and 27 phantom "Fully Paid" | **C** |
| D3 | Overpayment balance | merge paths clamp negative → 0 (SF:6810, 12830) | recompute allows negative | two formulas; which one last ran wins | overpay, then student-merge → J$0; refresh dashboard → negative again | H |
| D4 | Fee income vs cashbook | `cestiSchoolFeePayments` | `cestis_quarter_*` deposits | **no linkage at all** (verified: zero cross-references); deposits in practice = subvention only; any fee income in the cashbook is manually re-keyed with no join key | record fee payment; cashbook shows nothing; no report reconciles the two | **C** |
| D5 | Fee dataset across Drive | `school_fee_management_system.json` (15 s legacy engine, local-wins, no timestamps) | `CESTIS_School_Fees.json` (page-cloud, per-key stamp LWW) + master snapshot + LMS backup | four artifacts, three merge disciplines, two token stores — each round-trip can resurrect what another path resolved | edit same student on two devices with different connect states; watch values flip between syncs | **C** |
| D6 | Payments after student merge | `executeMerge` keep-primary deletes secondary's payments **without tombstones** (SF:6841–6852) | legacy union-merge re-adds them as orphans | orphans count in payment-Σ but not student totals | merge duplicate student on A; sync; B re-uploads old payments → orphaned rows | H |
| D7 | Payment identity | `'PAY'+Date.now()` ids; receiptNumber free text | smart-merge force-add regenerates ids (SF:12842) | same-ms collision = silent replace (local-wins); force-add = same real payment under two ids | two clerks record simultaneously; or force-add during smart merge → double-counted payment | H |
| D8 | Cashbook quarter content | device A quarter blob | device B / 4 cloud copies | txns have **no lastModified** → edits never propagate (add-by-id only); budgets merge only-if-absent; 15 s pull-then-push with no version check | edit txn amount on A; B never sees it; B's next push restores old amount to cloud | **C** |
| D9 | Opening balance | stored `openingBalance` per quarter (carry-forward `carryForwardBalance` CB:6889) | recompute from prior quarter | persisted derived value; prior-quarter edits don't re-run it; also user-editable free text | edit last quarter's txn; new quarter's OB unchanged → all totals off | H |
| D10 | Budget vs virement view | cashbook `cestis_budget_*` + live txns | Virement's persisted `cesti_virement_cloud_cache` | mirror refreshed only on manual/loaded sync; approvals never write back | approve virement; cashbook budget unchanged; VR view stale until next sync | H |
| D11 | Salary fact | `cestisPayroll` runs (full statutory calc) | cashbook salary txns → pseudo-results written back into `cestisPayroll` (CB:5158–5272) with gross=net, statutory zeroed | one run mixes two regimes; YTD sums zeros; payslip-side edits overwritten on next cashbook touch | pay via cashbook, open payslip YTD → understated deductions | **C** |
| D12 | One human's identity | `voctrain_users`, `cestiUsers`, `dashboardUsers`, `cestisStaffMembers`, payroll `employees[].name`, cashbook `txn.details` free text, appraisal `USR:/CLK:/PAY:` ids | — | **every cross-app join is a name-string comparison** (SF/Payslip/appraisals/cashbook cited lines in §7 of cluster reports); renames fork the person | rename staff in payslip; cashbook sync creates a second employee; appraisals key a duplicate | H |
| D13 | Student identity | `voctrain_students` | `cestiSchoolFeeStudents` twins (+ accounts.studentDataId, denormalised name/course copies) | twin sync is per-record last-edit-wins on `updatedAt/lastModified`; records missing both stamps lose ties silently; same-name collapse can merge two real people | two same-name trainees in different intakes; watch collapse behaviour; or edit twin fields on both sides offline | H |
| D14 | Accounts store | `voctrain_users` (written) | `voctrain_userAccounts` (**read** at index:18293) | phantom key: read returns `[]` → in-memory accounts emptied, then **unguarded** `saveState` writes `[]` to `voctrain_users` (:6649) | any `students-updated` postMessage while accounts in memory → local account wipe (partially healed by cloud add-merge; local-only accounts/2FA lost) | **C** (active bug) |
| D15 | Google auth | `schoolDashboardGoogleAccessToken` family | `cestisGoogleAccessToken` family | two token stores; each page's sync paths split across them; one can be live while the other is expired | connect Cashbook only → page-cloud paths dead while legacy sync live; half the artifacts go stale | H |
| D16 | Grades | `voctrain_examResults.score` (live) | `voctrain_transcriptGrades` (manual, optionally writes back overwriting score/passed) + `students[].score` + `students[].gpa` (manual strings) | four values, three of them manually settable; transcript override rewrites exam history in place | grade an exam; enter manual grade with write-back on; original score destroyed (flag only) | H |
| D17 | Certification | `students[].stage/certNo/certDate` | `voctrain_certDownloadApprovals` | two-way reconcile (`reconcileCertifiedFromApprovals`) but certNo minted independently on two devices (random 4-digit, no cross-check); approvals collapse to one per student (multi-programme loses one) | certify same student on two devices before sync → two certNos; approval dedupe keeps first-seen | H |
| D18 | Attendance | `voctrain_attendance` day records | `students[].attendance` manual % | VC session minutes ("large-class attendance") | three unlinked truths; the stored % is typed by hand | open attendance page vs student card vs VC report | H |
| D19 | Attendance storage | legacy flat key | per-quarter buckets | mirror rewrites legacy from bucket on quarter switch (:7451–7517) | switch quarters mid-edit on two tabs | M |
| D20 | Programme naming | `cestiFeeStructure` name keys | skillAreas catalogue (seeded twice: core:158, index:4869) + Qual-Plan fallback copy + cert templates keyed by course name + unit catalogues | name string is the join key everywhere; four load-time normalisers rewrite student+payment rows to force convergence | rename a programme; fee structure key, templates and transcripts follow only via normaliser heuristics | H |
| D21 | Trainee bio | `voctrain_transcriptProfiles` (dob/address/idNo) | `voctrain_studentProfiles` + student fields + fee twin fields | four places, three alias spellings (`dob/dateOfBirth`, `trn/nationalId`, `phone/contact`) | edit dob in transcripts vs fee page → whichever synced last wins per record | M |
| D22 | Exam status | stored `exam.status` (+30 s recompute timer) | derivable from date/time | timer must run to converge | change device clock / suspend tab | M |
| D23 | Chat history | `voctrain_chat*` global | per-user `voctrain_user_<id>_chat*` + Drive chat file + backup envelope | 500-cap trimming is applied to uploads too — cloud copy shrinks | old messages silently gone everywhere after cap | M |
| D24 | Finance docs across files | `cestis_finance_invoices/quotes/pos` | each owned by 2 page-cloud files; `cestis_finance_convert` by 4 | same key pushed to multiple Drive files with independent stamps | edit invoices with hub open vs Invoice page open | M |
| D25 | Active quarter | `cestis_active_quarter` | written by 4 apps + synced inside voucher page-cloud file | cross-device view-state ping-pong | switch quarter on A; B's page flips under the user | L |
| D26 | Reports panels | index Reports (stale roll denominators, NaN attendance) | live roster | `reports-analytics` test documents 329-vs-220 counts | open Reports vs Students | M |
| D27 | Whole platform ×2 | root (online) | `Offline System/` (older build + local-server sync) | code fork: fee fixes, keep-separate, perf layer missing offline; data merge between the two worlds is **manual with no tooling** ("do it one way at a time") | run Centre offline a week while online copy also used → two divergent datasets, human decides | **C** (structural) |
| D28 | Time-clock code ×2 | `Staff.Clock.in.html` | index.html ttc block (:40347–46290) | "kept in lockstep" by hand; same keys, same Drive files — code drift = behavioural divergence on same data | compare edit semantics after any one-sided fix | M |
| D29 | Payslip dataset | legacy `employee_payroll_Backup.json` (60 s, name-keyed additive) | page-cloud `CESTIS_Staff_Payslips.json` (stamp LWW) | two engines, two folders; users/permissions exist only in legacy file | connect only one path; or let both run and race | H |
| D30 | Clock dataset | per-user Drive slices | page-cloud whole-store file + LMS master + LMS backup sweep | four cloud representations, different merge rules | admin aggregate vs page-cloud pull orderings | H |
| D31 | Offline↔online catch-alls | offline `CESTIS_LMS_Dashboard.json` + `CESTIS_ALL_DATA.json` | online `CESTIS_LMS_BACKUP.json` + `cestis-master-snapshot.json` | **different file names, different folders — they never reconcile**; an offline data folder dropped into Drive is partly ignored by the online build | copy `data/` to Drive per the README; dashboard + catch-all data silently doesn't round-trip | H |
| D32 | Fee roll ownership (offline build) | offline `index.html` page-cloud spec owns `cestiSchoolFeeStudents` | offline `School.Fee.html` owns the same key in its own file | two owners, two files, independent stamps, no arbitration | edit roll from dashboard vs fee page offline; pull order decides the winner | H |

## 5. Derived-then-stored register (compute-then-persist — the spec's "primary bug" class)

| Value | Formula | Stored at | Staleness |
|---|---|---|---|
| `student.balance`, `totalPaid`, `status` | tuition − Σpayments (canonical :6322) **plus 7 incremental paths** | fee record → disk, both fee Drive files, mirrors, exports | fixed only by next dashboard refresh on that device |
| `student.tuitionFee` | copy of `feeStructure[key].total` at add/edit/backfill/import/merge | fee record | programme fee changes never reprice existing students; programme *change* silently reprices to current total (SF:7298) |
| Cashbook `openingBalance` | prev-quarter closing, manual trigger | quarter blob | silently stale after prior-quarter edits; also hand-editable |
| Payroll `results[]` | statutory calc at run time (two formula variants) | `cestisPayroll` forever | settings/rate changes never recompute (accepted); cashbook-written results zero statutory |
| Cashbook→payroll `gross=netPay=Σtxns`, `salary:=first txn amount` | CB:5179–5226 | `cestisPayroll` | a guess persisted as fact |
| `cesti_virement_cloud_cache` | copy of cashbook quarters | Virement store + its Drive backup | stale between manual syncs |
| Doc `number` | local max+1 | finance doc | collides across devices (duplicate invoice numbers) |
| `certNo/certDate` | random mint at stage-transition/backfill (two algorithms) | student + approvals | two devices mint different numbers; en-US date string |
| `stage='certified'/progress≥90` | from approvals | students | two-way reconcile in render path |
| `student.progress/gpa/attendance` | manual scalars (progress = stage constants 10/40/90/100) | students | never derived from records |
| `exam.status/passRate` | date/time + results | exams | 30 s timer |
| skillArea `students/materials` counts | tally | skillAreas | recomputed on change; stored copy rides every sync |
| Enrolment stamps (centre/FY/intake on students) | copy of centre fields | students | centre edits don't re-stamp |
| `totalWords/sumWords`, page-cloud stamp maps, snapshot counts/checksum, `cestisDataHighWater` | various | various | by-design derived persistence (low risk, snapshot checksum is protective) |

## 6. Silent-write register (writes with no user action, or bypassing the guarded path)

**During page load:** School.Fee runs 6 normalisers, each may `saveData()`+`saveFeeStructure()` (and thereby postMessage the roll + queue Drive pushes); index `loadState` writes 5+ keys (dedupe rewrites, cert migration, certNo backfill, intake release); Student-Progress init dedupe/migrate may rewrite **all 8 collections**; Transcript-Grades seeds unit catalogues (staff only); Cashbook `sanitizeAllQuarterlyStorage` **rewrites every quarter blob 2024→now+1, deleting out-of-quarter transactions**; Payment Voucher cloud pull writes cashbook quarter keys + active quarter; Payslip DOMContentLoaded seeds users; Clock-in DOMContentLoaded sets `cestisCurrentUser` to the first Admin **without authentication**; Virement seeds 17 preset requests when empty.

**During render/read:** `renderCertDownloadMgmt` → dedupe + reconcile + backfill (student writes inside render); `dedupeAttendanceRecords` rewrite (5 s throttle) at top of both attendance renderers; `backfillCertificateNumbers` inside the **public** certificate-check path; cert-PDF generation increments `downloadCount` + `saveState`; Cashbook `loadBudgetOverrides→saveQuarterBudget` inside `refreshAll`; Payslip `populatePayslipSelects`/`refreshAllData` save from nav/toolbar; Payslip `autoSaveUsersToCloud` mutates DATA inside an upload (60 s tick).

**Cross-app:** School.Fee ⇄ `voctrain_students` (+ back-references rewritten inside every `saveData`); Student-Progress → `cestiSchoolFeeStudents`; Cashbook → `cestisPayroll`; appraisals → LMS notifications by name-match; index mirror wrapper wraps `saveState`/`addStudent` themselves.

**Global:** `cestis-page-cloud.js` **monkey-patches `CESTISStore.setItem`** (:321–333) — every write to an owned key by any code schedules a Drive upload; combined with load-time normaliser writes, *opening a page can trigger network writes*.

Raw-storage bypasses of CESTISStore: only `voctrain_extSysCertHelpSeen_*` (deliberate, per-device). The store itself is the single storage chokepoint — good news for the DAL refactor.

## 7. Data-loss risk register

| # | Risk | Where | Sev |
|---|---|---|---|
| L1 | Phantom-key account wipe (D14) — `[]` written over `voctrain_users` unguarded | index:18293 + :6649 | **C** |
| L2 | Destructive replace paths: `syncFromCloud` (index :25476, School.Fee :12295, Cashbook :3960, Payslip users :4228); Clock-in login-sync replaces the **entire staff DB + history with one user's slice** (:4491, :8152) | multiple | **C** |
| L3 | Legacy fee auto-sync: local-wins whole-record every 15 s, no timestamps — stale device reverts newer edits perpetually | SF:13561–13661 | **C** |
| L4 | Cashbook load-time sanitizers silently **delete** transactions whose month is outside their quarter | CB:4296–4339 | H |
| L5 | Q3-FY2025/26 seed resurrection: empty quarter re-mints 52 default txns (real salary data), pushable cloudward | CB:6783/5068/7086 | H |
| L6 | No tombstones for: cashbook txn edits, budgets, finance docs, clock staff/records, payslip employees/runs, non-student LMS content → deletions resurrect via add-only merges | cluster reports §6 | H |
| L7 | Admin time-record edits don't bump `lastModified` → corrections overwritten by staff device's re-upload | Clock:7231–7297 | H |
| L8 | Unguarded empty writes in `saveState` for users/attendance/examResults/studentProfiles/systemSettings (guarded `saveCollection` exists but not used for these) | index:6646–6658 | H |
| L9 | ID/number collisions: `PAY+Date.now()`, `'STU'+Date.now()+rand` import ids, invoice local max+1, certNo rand4, `SESSION_+Date.now()` | multiple | H |
| L10 | No ETag/version check on any bespoke sync push (only the main-folder LMS backup is version-gated); 15 s/60 s pull-then-push races | CB/SF/Payslip/Clock | H |
| L11 | Same-name collapse + name-only account linking can merge two real people | core/index | H |
| L12 | Demo-purge blocklists match by **title** — a real exam titled like a demo is silently dropped/never merged | index:7735/25546/26796 | M |
| L13 | `getItem` localStorage-first: stale LS beats newer IDB; >5 MB values invisible cross-tab | core:110–114 | M |
| L14 | Caps trim the cloud too: chat 500/room, notifications 50 | index:6273–6277 | M |
| L15 | `clearAllSessionData` on admin/instructor logout wipes the device's `voctrain_*` keys — durability rests on Drive at that moment | index:6567 | M |
| L16 | Backup coverage gaps: local export omits `cestisPayroll`, `dashboardUsers`, notifications, vcSessions, per-user keys (its own comment claims payroll is included — false); fee local backup omits feeStructure/users/tombstones; virement page-cloud omits its deleted-ids | index:5631–5660, SF:10151+, VR | M |
| L17 | Index-based row mutations race background merges (clock editor, payslip edits, CTR `setStatus(idx)`) | multiple | M |
| L18 | Re-created centre re-hidden: tombstone union resurrects cleared tombstones from other devices | core:3058/4923 | M |
| L19 | High-water mark blocks legitimate shrink until manual reset | Payslip:1589 | L |
| L20 | Length-based change polling misses same-length edits (Transcript/CTR) | TG:1163, CTR:218 | L |
| L21 | Offline↔online reconciliation is whole-key last-write-wins with **no tooling and no detection**: a week of one side's edits to `voctrain_students` (one JSON blob) is discarded wholesale; stale tombstone lists resurrect deleted records or re-delete live ones; `savedBy` is written but never read; the tests that would catch this (`no-data-loss`, `deletion-tombstones`) are absent from the offline tree | Offline System (README §6 is the entire policy) | **C** |
| L22 | Offline server writes: fixed `<file>.json.tmp` name defeats temp+rename atomicity under two concurrent PUTs (mixed buffer can be published); no locking, no ETag/version, no fsync, **no server-side backups of `data/`** (memory-stick copies only) | `cestis-offline-server.js` | H |
| L23 | An "offline" install on a machine with internet + a stored token **silently syncs into the live production Drive folder** (identical hardcoded `FOLDER_ID`), merging a stale offline build's data into production | offline `cestis-page-cloud.js` Drive fallback | **C** |

**Existing safeguards worth keeping (verified working):** `guardedSet`/empty-never-wins in both directions + rescue reporting; tombstone union across 4 lists; page-cloud per-key stamps; version-gated main-backup pull; `CESTISStore.writes` write-gating; snapshot checksums + add-only reconcile with data-loss toasts; `navigator.storage.persist()`; PBKDF2 with lazy upgrade; forced default-password change; OTP attempt caps; anti-fork `LOOKUP_FAILED` sentinel; the 2,400-assertion test suite (including `no-data-loss`, `cloud-merge`, `deletion-tombstones`, `same-name-collapse`).

## 8. Security / PII exposure register (repository is PUBLIC)

| # | Exposure | Location |
|---|---|---|
| P1 | **Real staff PII: 11 people with full names, mobile numbers, dates of birth, TRN (tax ids), NIS numbers, salaries** in a seed block | `Staff.Payslip.html:3427–3439` + same block in `Offline System/Staff.Payslip.html` |
| P2 | Real staff names + monthly salaries + cheque numbers + an "(Advance Taken)" note in cashbook seed txns; real budget + subvention figures | `CESTIS.Cashbook.html:4493–4547`, :4364–4374; re-asserted in `tests/finance-core.test.js:65` |
| P3 | Company TRN `003-731-804` and **bank account number** `561722854` | `finance-docs.js:33–34`, `Finance.Payment.Voucher.html:94` |
| P4 | Real-looking trainee names in tests (from live bug screenshots), incl. real record ids; real personal names in vc-sessions/appraisal tests matching the repo owner's family | `tests/centre-key-identity.test.js:35`, `same-name-collapse.test.js:39`, `cestis-core.js:632/217`, `vc-sessions.test.js:22–36`, `staff-appraisals.test.js:143` |
| P5 | Hardcoded credentials: `cestisadmin/cestisadmin123$` (index seeds + Cashbook login), `Cestisadmin/Hazardadmin123$` (School.Fee), `admin/admin123` (Clock-in + ttc), virement PIN `1234`, payroll unlock `123654`; student default password scheme + hardcoded salt published (`Student-Progress:1118`) | multiple |
| P6 | 17 real virement requests with amounts; default signatory name | `Virement.Request.html:4154–4249`, PV:335 |
| P7 | Operational identifiers: OAuth client id, ~12 Drive folder ids, EmailJS keys ×3 apps | multiple |
| P8 | Design-level: OAuth tokens persisted in shared storage; password hashes + legacy plaintext uploaded in `school_fee_management_system.json`; `dashboardUsers` TOTP secrets + backup codes plaintext (and synced); per-user Drive files carry full staff PII incl. embedded PDF documents; statutory tax rates fetched at runtime from a personal GitHub repo (`stevebarrettsrha-ops/…/rates.json`) — supply-chain trust | design |
| P9 | Institution contact block (business, deliberate) on certificates/docs | core:3592–3599 etc. |
| P10 | Offline LAN data API is **unauthenticated with `Access-Control-Allow-Origin: *`** — any device that can reach port 8080 can read and rewrite the Centre's entire records (`data/` holds all PII) | `cestis-offline-server.js` |
| P11 | `Offline System/data/` is **not gitignored** (only `cert/` is) — clean today, but a Centre that commits after real use publishes every record to the public repo | `.gitignore` both trees |

*(P1–P6 are candidates for scrubbing + history rewrite; that is a Phase 5 work item with client sign-off — nothing was changed in Phase 0.)*

## 9. What the current system already does that MegaData must not regress

Cross-device sync exists and mostly converges (adds); deletion propagates for students/fee ids/centres/fee payments; offline-first operation with full local replica; per-user login folders on Drive; maintenance mode; role-gated pages incl. adminstaff access grid; export/import backup; master snapshot with checksum + rescue reporting; extensive candid in-code postmortems that constitute an incident history (roll-wipe, $29k reconciliation gap, 116-vs-220 headcount, seed-overwrite regressions, centre renumbering swaps).

## 10. Environmental facts that bind the design

Single https origin (GitHub Pages) — fragments *fail on file://* by design (`index.html:10487`), the Offline System exists to serve LAN devices instead; every app is same-origin so one IndexedDB is shared; two Google token stores split sync liveness; full-`drive` OAuth scope everywhere; EmailJS is the only email channel; money = floats, J$ implied.

## 11. Empirical scale (Phase 0 measurement for D4 of the decisions register)

368 trainees / 130 payments in the anonymised fixture of the real page-cloud backup; profiling audit used 800–1,200-row rosters, 6,000 attendance rows, 4,000 exam results, 2,000 payments; fee cadence evidence: **per-programme fees split over up to 9 terms; FY runs Apr–Mar with Q1=Apr–Jun; students bucket by enrolment FY; payments by payment date; dashboard defaults to "All Quarters = whole roll"** — cadence to confirm with client (looks termly-per-programme, not monthly).

## 12. Corrections to the prior audits (claims tested against code)

1. "Pages/* markup-only, no scripts, no storage (verified)" — **partially false**: 109 inline event handlers across 20 fragments execute post-injection; 3 fragments inject global CSS.
2. Tombstones exist for **4** entity families (LMS students, centres, fee LMS-ids, fee payments), not 2 — but still absent everywhere else (L6).
3. `cestisGenId()` lives in index.html (:24409), not in the core; sibling apps still mint `Date.now()` ids (L9) — the audit's "every cross-device record id" claim is false outside index.html.
4. Longevity-audit's claim that the local export includes payroll is **false**: `cestisPayroll` and `dashboardUsers` are omitted from the key list (index:5646–5650).
5. Productivity-audit line refs for writes-inside-render (35918/37429) are stale; real sites are :36428/:37948; its "~16 whole-quarter parses per render" is not literal (worst observed: 12 in recon print-preview).
6. "User Login README: SHA-256 only" — stale: code uses PBKDF2 with SHA-256 legacy tolerance and a plaintext-compare fallback (three formats in the wild).
7. `node --check`-style syntax gates: the audits' headless harness claim stands, but note several tests execute code scraped from index.html at test time — they pin the *text*, not a module boundary.

## 13. Offline System drift register

**Headline: root is ahead on everything except the local-server backend.** No file is newer offline except two genuine offline-only improvements. The offline `cestis-core.js` contains *zero* offline-specific code — it is simply an older snapshot (−1,119 lines). The fork is unversioned: nothing records which root commit it was cut from.

### 13.1 Files differing (15) — all "offline is older" except where noted

| File | Δ lines | Nature |
|---|---|---|
| `School.Fee.html` | −1,270 | older: missing keep-separate UI, perf-cache layer, **`renderFeeStructure` terms-crash guard** (offline still throws on a malformed fee entry, killing page init — the exact incident root's fix memorialises), new twin-intake semantics |
| `cestis-core.js` | −1,119 | older: missing `keepSeparate` machinery, `twinIndex`, catalogue read-through, `sharedPullPlan`/`SHARED_SOURCES`, ~20 exports |
| `index.html` | −551 | mostly older + one offline hook (registers `CESTIS_LMS_Dashboard.json`; **owns `cestiSchoolFeeStudents` → D32**) |
| `Student-Progress.html` | −198 | older: no keep-separate, no catalogue read-through |
| `cestis-page-cloud.js` | −8 (173/165 changed) | **the only real offline-specific file**: probes `/_cestis/health`, uses `LOCAL_BASE='/_cestis/data/'`, registers `CESTIS_ALL_DATA.json` whole-store sweep; **falls back to Google Drive with the identical production `FOLDER_ID` when the local server doesn't answer** (L23) |
| `CESTIS.Cashbook.html` −38, `Virement.Request.html` −21, `Staff.Payslip.html` −20, `staff-appraisals.js` −20, `Staff.Clock.in.html` −6, `Transcript-Grades.html` −4, `Cert-Transcript-Requests.html` −3, `.gitignore` −3, `package.json` (test list), `tests/cestis-core.test.js` −13 | | older: missing debounce/idle-tick/position-map perf fixes and `reads:` shared-key declarations (offline tree has **zero** `reads:` declarations — cross-page shared pulls don't exist there); offline core test **asserts the old collapse behaviour** and would fail against root's core |

Identical: all `Pages/*`, all `vendor/*`, `Finance.*`, `PDF.Workshop`, `Qual-Plan`, chat/VC fragments, `cert-template-seed.js`, `cmc-portal.js`, `finance-docs.js`, `transcript-assets.js`, `LONGEVITY-AUDIT.md`, `User Login/`, 16 of 17 shared tests. Root-only: the docs, the fixture, and **16 test files including `no-data-loss`, `deletion-tombstones`, `same-name-collapse`, `twin-index`, all `centre-*` and most `school-fee-*`**. Offline-only: the server (`cestis-offline-server.js`), signalling/cert/rtc helpers, 3 START launchers, the two READMEs.

Offline-ahead (2 items): an `API._applying` echo-suppression guard in the patched `setItem` (root lacks it — a pull's own writes get re-stamped and re-pushed in root); the live use of `spec.all` (`CESTIS_ALL_DATA.json`) which root's core supports and tests **but root's page-cloud never declares** — tested dead capability online, live untested capability offline.

### 13.2 Offline server API (`cestis-offline-server.js`, Node core only)

`GET /_cestis/health` → `{ok, mode:'offline-lan', …}` (the client's backend probe) · `GET /_cestis/data` → file list · `GET/PUT/POST /_cestis/data/<name>` → read/replace whole page-payload JSON (404 reads return `{}`) · `GET /_cestis/rooms` → signalling diagnostics · PeerJS id stub · static file serving with Range support. HTTPS via self-signed cert (`openssl`, generated into `cert/`), HTTP fallback. Writes are temp-file+rename but with a **fixed `.tmp` name**, no locking, no version preconditions, no fsync, no server-side backups (L22). **No authentication; CORS `*`** (P10). Merge is entirely client-side (GET → `mergeKeys` → PUT): classic lost-update window between two devices.

### 13.3 data/ ↔ Drive mapping

The 13 per-page file names are **identical strings** to the online Drive file names (same `file:` values) — the README's "same format, can be read by the online system" claim is true for those. It is **false** for the two catch-alls: offline `CESTIS_LMS_Dashboard.json` and `CESTIS_ALL_DATA.json` have no online counterpart (online uses `CESTIS_LMS_BACKUP.json` + `cestis-master-snapshot.json`, different folders) — D31. Per-machine keys (tokens, file ids, current-user, dark mode, stamp maps) are excluded from the sweep, deliberately and sensibly.

### 13.4 Offline↔online reconciliation

**No tooling exists** — no script, no import/export UI, no divergence report, no conflict log; the documented policy is one sentence in `READ ME FIRST.txt` ("do it one way at a time… somebody has to decide which stands"). Mechanically, reconciliation is whole-key newest-stamp-wins over blob-sized keys (the entire trainee roll is one key), with the loss modes in L21. `Pages/*` feature data offline reaches disk **only** via the `ALL_DATA` sweep, which registers lazily inside other pages' init — a device that only opens fragment-backed features may never persist them to the server.

### 13.5 Launchers / packaging

START-{WINDOWS,MAC,LINUX} run the Node server (fallback: Python static serving with a printed warning that data sharing and video won't work). `package.json` differs only in the test list (17 vs 33 files). The offline copy carries no fork-point version marker.
