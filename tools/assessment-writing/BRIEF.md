# Brief: writing prepared assessment banks for the CESTIS training centre

## Who this is for
CESTIS is a community vocational training centre in Jamaica. It trains adults and school-leavers for
national vocational qualifications (NVQ-J, awarded through HEART/NSTA Trust). Trainees are Level 2,
or Level 3 for some programmes. Many read English as a second-best skill, and many sit the theory
tests on a phone. The owner asked for prepared tests for every unit of every programme.

Each unit gets one **bank** file. The system turns the bank into four assessments:
- **Theory 1:** 45 multiple choice, 2 h 30 min (`minutes: 150`).
- **Theory 2:** 15 short answers and 10 essays, 3 h 35 min (`minutes: 215`).
- **Practical 1 and Practical 2:** group tasks for 4–5 trainees. They photograph their work as
  evidence and the assessor gives each member a result.

The pass mark is fixed by the Centre at 65%, so do **not** put `passMark` in the file. Every test
starts as "To check": an instructor reads and corrects it before any trainee sees it. Your job is to
make that check quick, by giving the instructor accurate, well-made questions.

## Read first
1. `/home/user/C.E.S.T.I.S-Train/assessments/README.md` covers the format and rules.
2. `/home/user/C.E.S.T.I.S-Train/assessments/welding-fabrication/memfab0042c.json` is the sample:
   copy its structure and level of detail. Note one flaw in it: its right answer is too often the
   longest option. Do not repeat that.
3. `/home/user/cestis-work/banks/batches.json` holds your batch: the units you write, and for
   each unit any other qualifications that also use it (`alsoIn`).
4. `/home/user/cestis-work/banks/worklist-l2-core.json` lists each qualification's id, exact title,
   code, programme (`skillArea`) and level.

## The file, exactly
- Path: `/home/user/cestis-work/banks/out/<folder>/<unit code in lower case>.json`, where `<folder>`
  is your batch's `folder`. One file per unit; write each with the Write tool.
- `format: "cestis-assessment-bank"`, `version: 1`, `status: "to-check"`, `written: "2026-10-31"`.
- `note`: "Prepared from the unit title and the trade's usual practice. An instructor must read and
  correct it, and mark it Ready, before it is opened for an intake."
- `programme`, `qualification {id, title, code}` and `level` must be **exactly** the batch home
  qualification's values from worklist-l2-core.json. (`programme` is its `skillArea`.)
- `unit {code, title}`: exactly as given in batches.json, including odd capitals and dashes.
- `theory1`: `minutes: 150`; `instructions` (as in the sample); and `questions`, exactly 45 of:
  `{id: "T1-01"…"T1-45", topic, stem, options: [4 strings], answer: 0-3}`.
- `theory2`: `minutes: 215`; `instructions`; and:
  - `shortAnswers`: exactly 15 of `{id: "T2-S01"…, topic, stem, accepted: [...], marks: 2}`.
  - `essays`: exactly 10 of `{id: "T2-E01"…, topic, stem, modelAnswer, markingPoints: [...], marks: 5}`.
- `practical1` and `practical2`: each `{title, brief, time, materials: [...], photos: [...],
  checklist: [...], safety: [...]}`.

## How to write the questions
- **Cover the whole unit.** Work out what a competent person does in this unit: plan and prepare,
  stay safe, choose and check tools and materials, follow the method, check the quality, finish,
  clean up and report. Spread the 45 questions across all of it, and set `topic` to say which part
  each question covers.
- **Level 2 language.** Short sentences and everyday words. Explain a trade term where it first
  matters. Use metric units first. Use Jamaican settings and made-up Jamaican-style names where a
  person is needed.
- **Multiple choice.**
  - One right answer. Three wrong ones that are believable to a beginner, but clearly wrong to
    anyone who knows the work.
  - Make every option about the same length and form. The right answer must not stand out by
    being longest, most detailed or most hedged.
  - Spread the right answers over a, b, c and d (about 11 each, never fewer than 7 or more than 16).
  - No "all of the above", "none of the above", trick wording or double negatives. Use "Which is
    NOT…" at most twice, with NOT in capitals.
  - Never ask the same question twice in a bank, across the short answers and essays too.
- **Short answers.**
  - The answer is one to four words that can be matched exactly, such as a name, number, term or
    tool.
  - List every reasonable way to write it in `accepted`: spellings, singular and plural, with and
    without "a"/"the", and digits as well as words for numbers (for example "10 mm", "10mm", "10").
  - Do not set a question that has many right answers; the essays are for that.
- **Essays.**
  - Ask the trainee to explain, describe steps, compare, or say why.
  - The `modelAnswer` is 80–200 words, as a good Level 2 answer would be.
  - Give 3–5 `markingPoints`, each one thing the assessor gives a mark for.
- **Practicals.**
  - Two different tasks a group of 4–5 can do at the Centre in the time given (usually 2–4 hours).
  - Each task must produce work that can be seen and photographed. Every member takes part, and
    the brief says how.
  - `photos`: list at least 4 stages to photograph.
  - `checklist`: at least 5 things the assessor can see each member do.
  - `safety`: list at least 3 points.
  - Some units are not hands-on, such as communication, computer, customer service, business,
    stress or time management. For those, set group activities that leave visible evidence:
    - a completed form, plan, quotation, report or poster;
    - a role play, with a photo of each stage and the notes;
    - photos of a computer or phone screen at each step.
- **Units shared by several programmes** (`alsoIn` is not empty). Write for all of those trades:
  use general workplace examples, or mix examples from each trade. Don't make it specific to one.

## Accuracy and safety
- Get technical facts right. If you are not sure of a figure (a setting, pressure, temperature,
  current or distance), ask about the principle instead, or give a safe range the trade generally
  agrees on.
- Never teach unsafe practice. Safety answers must match accepted practice. Where it applies, say
  "follow the maker's instructions and the Centre's rules".
- Do not quote clause numbers from codes or standards. Do not name brands. Do not copy text from
  HEART/NSTA or NCTVET documents. Write everything yourself.
- **Electrical units:**
  - Teach safe isolation: switch off, lock off, tag, prove dead with a tester that is checked
    before and after use, and never work live.
  - Give general good practice, not one country's code clause.
- **Jamaica facts:** mains supply is 110 V / 220 V single-phase at **50 Hz** (never 60 Hz); money is J$; the tax on sales is GCT (do not state its rate; say "at the current rate").
- **Gas, hot work and chemicals** (beauty and cosmetology products, cleaning chemicals): include
  ventilation, PPE, storage and first-aid points that are correct.

## Check your work
Run `node /home/user/cestis-work/banks/check.js /home/user/cestis-work/banks/out/<folder>/<file>.json`
on each file, and fix it until it prints ✓. The checker covers:
- the system's own bank check;
- exact names and codes;
- spread of right answers, and the longest-option giveaway;
- repeated questions;
- marks, times, and counts.

Do not edit anything under `/home/user/C.E.S.T.I.S-Train`, and do not run git.

## Report back (short)
- One line per unit: the file, and the checker's ✓ line.
- Any unit whose title was unclear, or where an instructor should look closely (for example a
  figure you were not sure of). One line each.

## Salon and beauty units (Cosmetology, Beauty Therapy)
- **Chemicals (relaxers, perms, colour, tints, bleach, nail products):** follow the maker's instructions. Do a skin/patch test (often 48 hours) and a strand test where the maker requires one. Check the scalp and skin for cuts, irritation or contraindications first. Use gloves and ventilation, never mix brands, and store products safely.
- **Hygiene:**
  - Clean, then disinfect, tools between clients. Know the difference between cleaning, disinfecting and sterilising.
  - Use single-use items (blades, files, orange sticks) once only.
  - Put sharps in a sharps box. Use fresh towels for each client.
- **Heat:** test wax and hot tools before they touch the client (for example, wax on the therapist's inner wrist).
- **Contraindications:** know when NOT to treat: infections, open wounds, recent sun damage, certain medical conditions. In those cases, refer to a doctor.
- **Practicals on people:** trainees work on each other or on models who agree, in the Centre's salon. Photos show only the work area (hands, nails, hair), never faces, unless the model agrees and the Centre allows it.

## Hospitality units (housekeeping, front office, food and beverage, kitchen, pastry)
- **Food safety:**
  - Keep cold food at 5 °C or below.
  - Hot-hold at about 63 °C or above.
  - The danger zone is between those.
  - Cook poultry and minced meat to a core temperature of about 74 °C, checked with a clean probe thermometer.
  - Cool food quickly, and keep raw and ready-to-eat foods apart.
  - Use colour-coded boards if the Centre uses them.
  - Wash hands, know the allergens, and label and date food (first in, first out).
  - Add "or as the Centre's food safety plan says" where figures appear.
  - Food handlers in Jamaica need a Food Handler's Permit from the local health department.
- **Knives and equipment:** use the right knife, keep it sharp, carry it point down, never try to catch a falling knife, and clean it straight after use. Guards stay on slicers and mixers.
- **Housekeeping chemicals:** read the label and the SDS, dilute correctly, never mix products (especially bleach and ammonia), use gloves, and use wet-floor signs. Handle linen and sharps carefully, and lift safely.
- **Front office:**
  - Guest privacy and room security: never say a guest's room number aloud, and check ID.
  - Cash handling, and payments in J$ and US$ (tourism takes both). Exchange rates and tax rates are given only by the assessor.
- **Team Jamaica** is the TPDCo (Tourism Product Development Company) training for people who work with visitors.
- Use Jamaican dishes and products where natural (ackee and saltfish, callaloo, jerk, festival, bammy, rum cake, bun, sorrel, local fruit), alongside international standards.

## Level 3 units (Welding Level 3, Electrical Installation Level 3)
- **Level 3 depth.** A Level 3 trainee:
  - plans and leads work;
  - reads and applies standards and specifications;
  - does the calculations;
  - inspects and tests the work;
  - supervises others;
  - writes the reports.
- Questions should ask more "why", "what if" and "which is best for this job" than Level 2 questions do. The language stays plain.
- **adaptFrom.** When a unit in batches.json has `adaptFrom` (the path of a Level 2 bank on the same topic), read it and use it as a starting point only. A trainee who sat Level 2 may sit Level 3, so:
  - no question may be the same as one in the Level 2 bank;
  - write at least half the questions fresh;
  - raise the rest to Level 3 depth, with new wording.
  - The practicals must be Level 3 tasks: larger, planned, inspected and documented.
- The same kind of rule applies when a Welding Level 3 bank already exists with the same title as an Electrical Level 3 unit. Write the Electrical version for electrical work, with its own questions.

## Electives
- An elective is written exactly like a core unit: same format, counts and house rules.
- Several elective titles repeat across programmes or levels with a different code (for example "Assemble & disassemble scaffolding…" in both Welding and Electrical Level 3, or "Support continuous improvement…"). Each code gets its own bank with its own questions, written for its own trade. Before you finish, compare your stems with every bank in `/home/user/C.E.S.T.I.S-Train/assessments/` and every file in `/home/user/cestis-work/banks/out/` (other writers are working at the same time). No stem may repeat one word for word; reword anything very close.
- Where several electives are versions of one process (for example MMAW, GTAW or GMAW "to AWS specification" in different positions or on plate and pipe), read each title carefully and set questions and practicals on what makes that unit different: the joint, the position, the material, the test it must pass.
- AWS units: refer to "the AWS code or procedure the Centre uses" and "the welding procedure specification (WPS)". Do not quote clause numbers. Positions use AWS names (1G–6G, 1F–4F), with the ISO name accepted where helpful.

## Level 5 units (Business Administration (Management) Level 5)
- **Who they are.** Supervisors, managers and people who will become managers: in a business, a hotel, a school or a public body in Jamaica. They read well and can write a report. Use clear, professional English. Plain words still win over jargon; explain a term where it first matters.
- **Depth.** Level 5 asks people to analyse, decide, plan, lead, evaluate and justify. Multiple-choice questions should mostly be scenarios: "a manager at a Kingston firm finds…, what should she do first?", "which option best…". Short answers are still one to four exact words (a term, a figure, a named tool such as SWOT, PESTLE, KPI, Gantt).
- **Essays** ask for a plan, an evaluation, a comparison or a justified recommendation. The model answer is 120–200 words, at a good Level 5 standard. Give 3–5 marking points.
- **Practicals** are not workshop tasks. Set group tasks (4–5 people) that leave visible evidence the assessor can photograph: a written plan, budget, policy, report, proposal, minutes, a presentation with its slides, a role-played meeting or interview with notes, a spreadsheet on screen, a poster or chart. Every member has a named role and part of the evidence. List at least 4 photos, 5 checks and 3 "safety" points, which here can be confidentiality, data protection, respectful conduct, and wellbeing and workload.
- **Jamaican setting.** Use J$, GCT "at the current rate" (never a figure), Jamaican-style names and places. Refer to laws by their general purpose: employment law, the data protection law, the procurement rules for public bodies, company law, intellectual property law. Never quote sections or penalties. For public-sector units (codes starting PSS or PSA), set questions in a ministry, agency, parish council or public body.
- **Figures** in finance questions (budgets, ratios, variances, payback) are data given in the question. Work every sum yourself and check it twice.
- **Shared ideas.** Several units cover related ground (budgets, strategy, policy, partnerships, human resources, continuous improvement). Set each unit's questions on its own title and keep them distinct from its neighbours.
