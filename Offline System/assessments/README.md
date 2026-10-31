# Prepared assessments — the question banks

Every unit of every programme gets four assessments: **Theory 1**, **Theory 2**,
**Practical 1** and **Practical 2**. The questions and tasks for one unit are one file here,
`assessments/<programme-slug>/<unit-code in lower case>.json`, listed in `assessments/index.json`.

Nothing here reaches a trainee by itself. On the dashboard's **Assessments** page an instructor
(or the Administrator) prepares a unit's tests from its bank, checks and corrects each one in the
test builder, marks it **Ready**, and then **opens it for an intake** with dates. Every prepared
test starts as **To check**.

After adding or changing a bank, run:

```
node tools/build-assessment-index.js     # checks every bank and rewrites index.json
npm test                                 # tests/assessments-bank.test.js checks them again
```

A bank with a mistake is named with what is wrong and is left out of the index.

## How a bank is matched to the Centre's units

The units come from the Centre's Qualification Plan (Transcript / Grades → qualifications; the
Qualification Plans page has an **Export units** button that gives the whole list as a
spreadsheet: programme, qualification, unit code, unit title). A bank answers to a unit when
its **programme** is the same (the qualification's id or code, else its skill area and level)
and its **unit code** is the same (capitals, spaces and punctuation aside). Without a code, the
unit's **title** must match, written the same way. A unit with no bank shows *No prepared
assessments yet*.

The tests are named after the programme and the unit exactly as the Centre names them, for
example *Welding & Fabrication — MEMFAB0042C Perform weld in the flat and horizontal positions
using manual metal arc welding process (MMAW) — Theory 1*.

## The file

```jsonc
{
  "format": "cestis-assessment-bank",
  "version": 1,
  "status": "to-check",                 // always "to-check": an instructor checks every test
  "written": "2026-10-31",              // when the content was written (YYYY-MM-DD)
  "programme": "Welding & Fabrication", // the training centre / skill area, as the Centre names it
  "qualification": { "id": "QUAL-WEL-L2", "title": "WELDING LEVEL 2", "code": "MEM22423" },
  "level": 2,
  "unit": { "code": "MEMFAB0042C", "title": "Perform weld in the flat and horizontal positions using manual metal arc welding process (MMAW)" },

  "theory1": {                          // 45 multiple choice, 2 h 30 min
    "minutes": 150, "passMark": 70,
    "instructions": "Answer all 45 questions …",
    "questions": [                      // exactly 45
      { "id": "T1-01", "topic": "Safety and PPE",
        "stem": "Which filter shade is suggested …?",
        "options": ["Shade 3", "Shade 5", "Shade 10", "Shade 14"],   // exactly 4, all different
        "answer": 2 }                   // the ONE right option: 0 = first … 3 = fourth
    ]
  },

  "theory2": {                          // 15 short answers + 10 essays, 3 h 35 min
    "minutes": 215, "passMark": 70,
    "instructions": "Section A has 15 short answers …",
    "shortAnswers": [                   // exactly 15
      { "id": "T2-S01", "topic": "Electrodes",
        "stem": "In the classification E7018, what does the letter \"E\" stand for?",
        "accepted": ["electrode"],      // every answer that is right, as a trainee might write it
        "marks": 2 }
    ],
    "essays": [                         // exactly 10
      { "id": "T2-E01", "topic": "Safety and PPE",
        "stem": "Describe the personal protective equipment …",
        "modelAnswer": "A welding helmet with …",          // for the marker only
        "markingPoints": ["Helmet with the correct shade …", "…"],  // at least 2; for the marker only
        "marks": 5 }
    ]
  },

  "practical1": {                       // a group task (groups of 4 or 5)
    "title": "Three-pass fillet weld in the horizontal position (2F) on a tee joint",
    "brief": "As a group, set up a safe welding station and …",
    "time": "3 hours",
    "materials": ["2 pieces of 10 mm carbon steel plate …", "…"],
    "photos": ["The welding station set up …", "…"],      // the photos the group takes
    "checklist": ["Wore full PPE correctly throughout …", "…"],  // at least 3: what the assessor checks, for each member
    "safety": ["Weld only in a booth or behind screens …", "…"]  // at least 1
  },
  "practical2": { "…": "the same fields" }
}
```

What happens to each part:

- **Theory 1:** 45 multiple-choice questions, 1 mark each, options shown in a different order to
  each trainee, 5 to a page. Marked at once.
- **Theory 2:** Section A, 15 short answers (2 marks each): an answer that matches one of the
  `accepted` answers (capitals and spaces aside) is marked at once; any other answer waits for the
  assessor. Section B, 10 essays (5 marks each), marked by the assessor, who sees the model answer
  and the marking points beside each answer. The trainee never sees the model answer, the marking
  points or the accepted answers.
- **Practicals:** the group sees the brief, the materials, the safety points and the photos to
  take; the assessor records a result for each member against the `checklist`, with a comment.

## What the content writers need, for each programme

1. The unit list (from **Export units**): programme, qualification, unit code, unit title.
2. For each unit: the unit standard's elements and performance criteria (what a competent trainee
   does), the range (tools, materials, positions), and the Centre's own practice (machines,
   materials, local rules).
3. Rules for every question: one right answer and three wrong answers that are clearly wrong to
   someone who knows the work; plain words for Level 1–2 trainees in Jamaica; metric units first;
   no trick questions; safety content checked against the equipment maker's instructions and the
   Centre's rules. Spread the right answers across the four places.
4. An instructor reads every test before it is opened, especially safety content in electrical,
   gas and machinery work.

The sample bank is `welding-fabrication/memfab0042c.json` (Welding Level 2, MEMFAB0042C).
