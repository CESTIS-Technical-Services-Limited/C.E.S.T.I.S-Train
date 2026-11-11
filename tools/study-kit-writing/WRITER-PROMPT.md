You are writing study kits (study notes + a practice test, one JSON file per unit) for a Jamaican TVET training centre's learning system. The repository is /home/user/C.E.S.T.I.S-Train. The owner approved three pilot kits; yours must match them in quality, depth and accuracy. Trainees will study from these, so correctness matters more than speed.

Your batch: {{BATCH}} — {{N}} units:
{{UNITS}}

Read first:
1. tools/study-kit-writing/BRIEF.md — the rules (audience, depth by level, language, notes, questions). Follow it closely.
2. study-kits/SCHEMA.md — the exact JSON format and the allowed block types.
3. One approved pilot kit as your model (read it whole): {{MODEL}}
4. For EACH unit, its exam bank at assessments/<same path>. Copy programme/qualification/level/unit exactly from it. The notes must teach everything its questions (theory1, theory2, practicals) test. Your practice questions must NOT reuse its questions, scenarios or wording.

For each unit write study-kits/<same path as the bank> (e.g. assessments/welding-fabrication/memcor0012d.json -> study-kits/welding-fabrication/memcor0012d.json): 6–10 sections (first: Unit overview with a "What you must be able to do" table and no invented element/criteria numbers; last: Revision with "I can..." statements and key terms), 20 four-option questions on 4–6 Jamaican case studies (a few may stand alone with "c": null), a teaching "why" for every question, "status": "to-check", "written": "{{DATE}}". About 40–90 KB per kit; never pad. Within your batch, no two kits may share a case study or a question. Where a unit overlaps another one (a Level 3 unit on the same process as a Level 2 kit already in study-kits/, or two units on related topics), keep each kit on its own title and write its own questions.

Check every kit: node tools/build-study-kit-index.js --file study-kits/<folder>/<unit>.json — it must print "complete"; fix every problem it reports. Then re-read each kit once as a strict instructor: fix technical errors, giveaway options (the correct answer must not be the longest or most detailed), repeated questions, American spellings.

Then write tools/study-kit-writing/checks/{{BATCH}}.md: for each unit, a short list of the facts an instructor should double-check (figures you were unsure of, Jamaican claims, anything the exam bank itself gets wrong). Keep it factual and short.

Rules: write only your kit files, the checks file, and scratch files under /tmp/claude-0/-home-user-C-E-S-T-I-S-Train/289445a4-5602-5579-9838-659af443070f/scratchpad/kitgen/{{BATCH}}/ (your own folder: other writers work at the same time; a generator script there is fine). Do not edit any other repository file, do not run the index build without --file, do not touch git. Your final reply must be at most 6 lines: the batch id, each unit's checker result (complete or not), and the total KB written.
