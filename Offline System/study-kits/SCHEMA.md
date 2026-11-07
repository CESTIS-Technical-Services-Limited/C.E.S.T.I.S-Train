# Study kit format (`cestis-study-kit`, version 1)

One file per unit: `study-kits/<programme-folder>/<unitcode>.json`, at the same
path as the unit's exam bank under `assessments/` (for example
`assessments/welding-fabrication/memfab0111c.json` ->
`study-kits/welding-fabrication/memfab0111c.json`). The list of kits,
`study-kits/index.json`, is made by `node tools/build-study-kit-index.js`;
`node tools/build-study-kit-index.js --check` says whether it is up to date and
whether every kit passes the checks below.

Kits are shown to trainees and staff on their Resources page and open in
`study-kits/kit.html` (Course, Notes, Practice test). Nothing in a kit is HTML:
every piece of text is shown exactly as written. `**words**` shows as bold.

```json
{
  "format": "cestis-study-kit",
  "version": 1,
  "status": "to-check",
  "written": "2026-11-07",
  "programme": "Welding & Fabrication",
  "qualification": { "id": "QUAL-WEL-L2", "title": "WELDING LEVEL 2", "code": "MEM22423" },
  "level": 2,
  "unit": { "code": "MEMFAB0111C", "title": "Perform basic welding using manual metal arc welding process (MMAW)" },
  "summary": "Two or three sentences: what this unit is about and what the trainee will be able to do.",
  "sections": [
    { "title": "Unit overview", "blocks": [ { "p": "..." }, { "table": { "head": ["...", "..."], "rows": [["...", ["...", "..."]]] } } ] },
    { "title": "...", "blocks": [ ... ] }
  ],
  "cases": {
    "c1": { "title": "A short name for the situation", "text": "The situation, 2 to 5 sentences, with the facts the questions need." }
  },
  "questions": [
    { "id": "P-01", "c": "c1", "q": "The question?", "o": ["the correct answer", "wrong 1", "wrong 2", "wrong 3"], "a": 0, "why": "Why the correct answer is right." }
  ]
}
```

- `programme`, `qualification`, `level` and `unit` are copied from the unit's
  exam bank, exactly.
- `status`: `to-check` until an instructor has read it, then `ready`.
- `sections`: 5 to 12. The first is the unit overview; the last is revision
  (a checklist of "I can ..." statements and key terms).
- Blocks (each an object with ONE of these keys):
  - `{ "p": "text" }` a paragraph
  - `{ "h": "text" }` a sub-heading inside a section
  - `{ "ul": ["...", "..."] }` / `{ "ol": ["...", "..."] }` a list
  - `{ "table": { "head": ["A", "B"], "rows": [["a1", "b1"], ["a2", ["b2 point", "b2 point"]]] } }`
    a table; a cell is text, or a list of points
  - `{ "note": "text", "label": "Tip" }` a boxed note (`label` optional, e.g. Tip, Safety, Remember, Jamaica)
  - `{ "flow": ["step", "step", "step"] }` steps in order, drawn as a chain
  - `{ "terms": [["Term", "What it means"], ...] }` key terms
- `cases`: situations the questions refer to. A question with `"c": null`
  stands on its own.
- `questions`: 15 to 40 four-option questions. `a` is the index of the correct
  option in `o`; the page shuffles the options for every attempt, so write
  them in any order. Every question has a `why`.
- The practice questions are NOT the unit's exam questions: the check refuses
  any practice question too close to a question in the unit's exam bank.
