# Writing a study kit

A study kit is one unit's notes and practice test, for a trainee at a Jamaican
TVET centre (HEART/NSTA Trust, NCTVET / NVQ-J qualifications) to read on a
phone or an office PC, and for the unit's instructor to teach from. The
format is `study-kits/SCHEMA.md`. The owner's model is a cluster kit for
TVET managers: plain, well organised notes with tables, step chains and
boxed notes; then case-study questions, each with a short explanation.

## Before you write

1. Read the unit's exam bank, `assessments/<folder>/<unit>.json`. Copy its
   `programme`, `qualification`, `level` and `unit` into the kit exactly.
   Note its topics: the notes must teach everything the exam asks about.
2. Your practice questions must be DIFFERENT from the bank's: new
   situations, new wording, different facts tested where you can. The check
   refuses a practice question that is nearly the same as an exam question,
   or that has the same answer to a question about the same thing.

## The notes (`sections`, 6 to 10)

1. **Unit overview**: what the unit covers, who it is for, and a table of
   "What you must be able to do" (the unit's main tasks, in your own words,
   from the unit title and the trade's usual practice). Do NOT invent element
   numbers or performance-criteria numbers: the unit standard's own numbering
   is not in front of you.
2. Then one section per main topic, in the order the work is done (safety and
   preparation first, then the method, then checking, cleaning up, reporting).
   Use the blocks the format allows: short paragraphs, lists, tables
   (comparisons, faults and their causes and cures, settings), `flow` for a
   procedure, `note` for safety points (label "Safety"), tips ("Tip") and
   Jamaican practice ("Jamaica").
3. The last section is **Revision**: a checklist of "I can ..." statements and
   the key terms (`terms`).

Depth: enough that a trainee who reads only the kit can pass the unit's
theory exam. Facts must be correct and current; when a figure varies by
manufacturer or job (a current setting, a temperature, a timing), say so and
give a typical range, and tell the trainee to follow the manufacturer's
instructions and the instructor. Jamaica: 110 V / 220 V, 50 Hz; metric units;
money in JMD; Jamaican names and places in examples; NCTVET and HEART/NSTA
Trust where relevant. Never name a real private company as an example of bad
practice. No brand recommendations.

Language: plain English for Level 2 trainees. Short sentences. British
spelling (colour, centre, metre). Speak to the trainee ("you"). No jokes, no
filler, no "In conclusion". `**bold**` for the few words that matter most.

## The practice test (`cases` and `questions`)

- 20 questions (pilot kits), 4 options each, one correct (`a` is its index;
  options are shuffled on screen, so order does not matter).
- 4 to 6 short case studies (`cases`): a realistic job or salon/workshop
  situation in Jamaica with the facts the questions need; 2 to 5 questions on
  each. A few questions may stand alone (`"c": null`).
- Test understanding and judgement (what to do next, what went wrong, which
  is safest), not just recall.
- Wrong options must be believable mistakes a trainee might make: no silly
  or joke options, no "all of the above", no "none of the above". Keep the
  four options similar in length and style; the correct one must not stand
  out by being longest or most detailed.
- Every question has a `why` (one or two sentences) that teaches.
- Spread the correct answers: the page shuffles them, but write each set so
  that no option is a giveaway.

## The pilot kits are the model

The owner approved three pilot kits; read at least one of them before you
write, and match their depth, tone and structure:
`study-kits/welding-fabrication/memfab0111c.json`,
`study-kits/electrical-installation/eemels0011b.json`,
`study-kits/cosmetology/csbcos0031c.json`.

Size: about 40–90 KB per kit. A trade unit with a lot of method (a welding
process, an installation task, a salon service) sits at the top of that; a
short general unit (time management, a computer application, customer
service) at the bottom. Never pad.

## Level 3 and Level 5 units

- **Level 3** (Welding Level 3, Electrical Installation Level 3): the
  trainee plans and leads work, reads and applies standards and
  specifications, does the calculations, inspects and tests the work,
  supervises others and writes the reports. Notes go deeper into why, and
  into choosing the best method for a job; practice questions ask more
  "why", "what if" and "which is best for this job". Language stays plain.
  AWS units: refer to "the AWS code or procedure the Centre uses" and "the
  welding procedure specification (WPS)"; no clause numbers; positions by
  AWS names (1G–6G, 1F–4F).
- **Level 5** (Business Administration (Management)): supervisors and
  managers in Jamaican businesses, hotels, schools and public bodies.
  Clear professional English; explain a term where it first matters.
  Notes teach the models and tools (SWOT, PESTLE, KPIs, Gantt, budgets,
  variance, risk registers…) with worked examples; questions are mostly
  scenarios that ask what a manager should do or which option is best. Use
  J$, GCT "at the current rate" (never a figure); refer to laws by their
  purpose (employment law, the data protection law, procurement rules for
  public bodies), never sections or penalties. Public-sector units (PSS,
  PSA codes) are set in a ministry, an agency or a municipal corporation
  (parish councils became municipal corporations in 2016). Work every
  sum twice.
- **Hospitality**: guests from Jamaica and abroad, J$ and US$, Team Jamaica
  (TPDCo), Jamaican dishes and products where natural.
- **General units** shared by several programmes (communication, maths,
  computers, customer service, entrepreneurship, professionalism): write
  them so any trainee can use them, with examples from several trades.

## Check your kit

    node tools/build-study-kit-index.js --file study-kits/<folder>/<unit>.json

It must say "complete". Then the index is rebuilt by whoever merges the kits
(`node tools/build-study-kit-index.js`).
