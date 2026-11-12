# Things the kit writers found in the exam banks

While writing the kits, each writer read the unit's exam bank closely. These are the problems they reported in the exams (not in the kits). Each batch's full instructor checklist, with the facts to double-check in the kits, is in `checks/B###.md`. Fix these in `assessments/` and rebuild with `node tools/build-assessment-index.js`.

- Exam bank errors to fix later: CRIMAT0012B T2-S14 uses 240 V; CSAPQA0012A T2-S05 accepts 'micrometre' for the tool (all copies).
- Exam bank to review: MEMPRG0012A CNC model answers T2-E03, T2-E04 weak (see checks/B007.md).
- Exam bank error: MEMCOR0023C (welding L3) T1-33: no option right, keyed answer wrong (checks/B010.md).
- Consistency: filter shade for 3.2 mm MMAW: MEMFAB0042C bank+kit say 10 (ANSI suggests 10), pilot MEMFAB0111C says 11 (EN 169 80-175 A). Reconcile wording to 'shade 10 or 11 by current' after rollout.
- Exam bank error: MEMCOR0103C (welding L3) T1-11 and T1-37 no correct option (checks/B013.md).
- Exam bank: MEMCOR0141B (welding L3) T1-21 'fit-checked' respirator wording; T1-23 plate weight without width (checks/B014.md).
- Exam bank: MEMFAB0051B (welding L3) T1-40 says water is usual pressure-test medium; refrigeration/AC lines use dry nitrogen (checks/B016.md).
- Exam bank: ITICOR0011B (welding L3) short answers T2-S04, T2-S10, T2-S13 too lenient (checks/B024.md).
- Exam bank: MEMFAB0121B vs MEMFAB0122B (welding L3) disagree on thickness where leftward gas welding gives way to rightward; plus 2 issues in checks/B019.md.
- Exam bank: BSBSBM0012C (welding L3) T2-E06 'parish council' -> municipal corporation (since 2016). Also check Business Admin L5 banks for 'parish council'.
- Exam bank: MEMCOR0042A (electrical L3) T1-01 names the Government Electrical Inspectorate (now Government Electrical Regulator, GER).
- Exam bank: MEMFAB0062B (welding L3) T1-39 wrong answer key (checks/B017.md).
- Exam bank: PSSAPM0065B assumes negotiation with a preferred bidder is routine; Jamaican public procurement rules may not allow this (checks/B071.md).
- Safety first: MEMFAB0051B T1-40 says water is the usual pressure-test medium; refrigeration and air-conditioning lines are tested with dry nitrogen, never water.

## Done (this pass)

Fixed in `assessments/` (every copy of a shared unit): MEMFAB0051B T1-40 (now asks for the test medium for refrigeration lines: dry nitrogen); the questions with no correct option or a wrong key: MEMCOR0023C T1-33, MEMCOR0103C T1-11 and T1-37, MEMFAB0062B T1-39; CRIMAT0012B T2-S14 (220 V, 2 200 W, still 10 A); CSAPQA0012A T2-S05 (unit name "micrometre" no longer accepted); ITICOR0011B T2-S04, S10, S13 (loose accepted answers removed); MEMCOR0042A T1-01 (Government Electrical Regulator); MEMCOR0141B T1-21 and T1-23 (wording; plate width given); MEMPRG0012A T2-E03 and E04; CSBCOS0031C T2-E04 (friction now for a normal or dry scalp, light on an oily one, matching T2-E10); "parish council" is now "municipal corporation" in every bank and kit. PSSAPM0065B was already worded "only as the rules and documents allow", so it was left.

Done: Electrical Level 3 MEMMRD0663A and MEMMRD0683A now teach and test the Jamaican NEC-based code throughout, not the British BS 7671/BS 5266 methods; see `checks/B040.md` for what an instructor should still confirm (the NEC edition the Government Electrical Regulator has adopted, and so on).

Done: the 3.2 mm filter shade now follows the pilot (shade 11 for 80–175 A) in MEMFAB0042C's kit; no exam bank states a conflicting shade.

Done: leftward gas welding up to about 6 mm and rightward over about 6 mm, in MEMFAB0121B, MEMFAB0122B and the Level 2 MEMFAB0121C kit. Questions and practicals that used 6 mm plate for the rightward method now use 8 mm, so they are clearly on the rightward side of the line.
