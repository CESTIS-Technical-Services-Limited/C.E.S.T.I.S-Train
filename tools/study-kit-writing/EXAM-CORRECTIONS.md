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
- Exam-quality note: B040 EEMMRD0663A uses British (BS 7671) test method and EEMMRD0683A BS 5266 emergency lighting; Jamaica uses NEC-based code - instructor to confirm (checks/B040.md).
- Exam bank: PSSAPM0065B assumes negotiation with a preferred bidder is routine; Jamaican public procurement rules may not allow this (checks/B071.md).
- Safety first: MEMFAB0051B T1-40 says water is the usual pressure-test medium; refrigeration and air-conditioning lines are tested with dry nitrogen, never water.
