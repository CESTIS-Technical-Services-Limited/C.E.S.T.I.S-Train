/* The printed record of a completed assessment (cestis-assessment-pdf.js),
   drawn in Node with the site's own jsPDF and pdf-lib.
   Run: node tests/assessment-pdf.test.js

   Pinned: A4; the crest; the Centre's full name; "Assessment record ·
   Theory/Practical"; the document number; the trainee's details; started,
   finished, time allowed and extra time ("15 min, added by the
   Administrator"); where it was sat; the result box; every question; the
   marker's comment; her signature in the handwritten font (embedded from
   vendor/fonts, never a CDN) with "Electronically signed by … · Signature
   ID …"; blank Name / Signature / Date lines for the Administrator, the
   Invigilator (Assessor) and the Programme Coordinator; "Provisional" on a
   paper awaiting marking; page numbers; the footer naming where it is filed;
   a group practical's photos two to a page; several papers joined into one
   PDF for printing. */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { jsPDF } = require('../vendor/jspdf-2.5.1.umd.min.js');
const PDFLib = require('../vendor/pdf-lib-1.17.1.min.js');
const P = require('../cestis-assessment-pdf.js');
const S = require('./fixtures/assessments/samples.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const font = fs.readFileSync(path.join(ROOT, 'vendor/fonts/GreatVibes-Regular-latin.ttf')).toString('base64');
const crest = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ROOT, 'assessments/assets/crest-small.jpg')).toString('base64');
const fx = f => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures/assessments', f)).toString('base64');
const deps = (extra) => Object.assign({ jsPDF, font, crest, compress: false }, extra || {});
// Text drawn by jsPDF, uncompressed: "(…) Tj" — escaped parentheses and backslashes put back.
function textOf(doc) {
  const raw = doc.output();
  const out = [];
  raw.replace(/\(((?:\\.|[^\\)])*)\)\s*Tj/g, (m, s) => { out.push(s.replace(/\\([()\\])/g, '$1')); return m; });
  // The PDF's plain fonts write Western (Windows-1252) bytes: read them back as text.
  const W = { 0x80: '\u20ac', 0x85: '\u2026', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201c', 0x94: '\u201d', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014' };
  const dec = t => t.replace(/[\x80-\x9f]/g, c => W[c.charCodeAt(0)] || c);
  const lines = out.map(dec);
  return { raw, text: lines.join('\n'), flat: lines.join(' ') };
}

(async () => {
  console.log('A marked Theory 1');
  {
    const s = S.theory1();
    const doc = P.render(s.model, deps());
    const { raw, text, flat } = textOf(doc);
    const n = doc.getNumberOfPages();
    assert(Math.abs(doc.internal.pageSize.getWidth() - 210) < 0.1 && Math.abs(doc.internal.pageSize.getHeight() - 297) < 0.1, 'A4 portrait');
    assert(n >= 4 && n <= 12, 'several pages for 45 questions (' + n + ')');
    assert(flat.indexOf('Community Educational and Skills Training Institute and Services Ltd.') !== -1, 'the Centre\'s full name');
    assert(text.indexOf('Assessment record · Theory') !== -1 && text.indexOf(s.model.docNo) !== -1, 'Assessment record · Theory, and the document number');
    assert((raw.match(/\/Subtype \/Image/g) || []).length === 1, 'the crest, drawn once and reused on every page');
    ['Kemar Johnson', 'STU-3w8k2q', 'Welding & Fabrication', 'Sep 2026 – Jun 2027', 'MEMFAB0042C', 'Theory Assessment 1'].forEach(t => assert(text.indexOf(t) !== -1, 'shows ' + t));
    assert(text.indexOf('30 Oct 2026, 09:01 · 11:42') !== -1, 'started and finished, on the Centre\'s clock');
    assert(text.indexOf('2 h 30 min') !== -1 && text.indexOf('15 min, added by the Administrator') !== -1, 'time allowed and the extra time, and who added it');
    assert(text.indexOf('From home, invigilated online') !== -1, 'where it was sat');
    assert(text.indexOf('COMPETENT') !== -1 && /40 \/ 45 \(89%\) · pass mark 70%/.test(text), 'the result box (' + s.model.result.line + ')');
    assert(text.indexOf('45.  ') !== -1 && text.indexOf('No answer given') !== -1, 'all 45 questions, a blank answer said so');
    assert(text.indexOf('answer given · correct') !== -1 && text.indexOf('correct answer') !== -1, 'the answer given, the right answer marked');
    assert(/\/BaseFont \/[A-Z]*\+?GreatVibes/.test(raw) || raw.indexOf('GreatVibes') !== -1, 'the signature font is embedded in the file');
    assert(text.indexOf('Electronically signed by Kemar Johnson · 30 Oct 2026, 11:42 · Signature ID ' + s.result.signature.id) !== -1, 'the line under her signature');
    ['Administrator', 'Invigilator', 'Programme Coordinator'].forEach(r => assert(text.indexOf(r) !== -1, 'a block for the ' + r));
    assert((text.match(/^Name$/gm) || []).length === 3 && (text.match(/^Signature$/gm) || []).length === 3 && (text.match(/^Date$/gm) || []).length === 3, 'Name, Signature and Date left blank in each block');
    assert(text.indexOf('Marcia Thompson') === -1 && text.indexOf('Ian Barrett') === -1, 'no staff names printed in the blocks ("leave line blank, for all names")');
    assert(text.indexOf('Page 1 of ' + n) !== -1 && text.indexOf('Page ' + n + ' of ' + n) !== -1, 'page numbers');
    assert(flat.indexOf('Welding & Fabrication · Sep 2026 – Jun 2027 · MEMFAB0042C') !== -1, 'the footer names the programme, intake, unit and assessment');
    assert(text.indexOf('Assessment Results /') === -1, '...not a folder path');
    assert(text.indexOf('PROVISIONAL') === -1, 'a marked paper is not provisional');
    const bytes = new Uint8Array(P.render(s.model, deps({ compress: true })).output('arraybuffer'));
    assert(bytes.length < 260 * 1024, 'small enough to keep and send (' + Math.round(bytes.length / 1024) + ' KB)');
  }

  console.log('A Theory 2 awaiting marking');
  {
    const s = S.theory2();
    const doc = P.render(s.model, deps());
    const { text, flat } = textOf(doc);
    assert(text.indexOf('PROVISIONAL — AWAITING MARKING') !== -1, 'the result says "Provisional — awaiting marking"');
    assert((text.match(/PROVISIONAL/g) || []).length >= doc.getNumberOfPages() * 2, 'every page is marked PROVISIONAL (header and watermark)');
    assert(text.indexOf('Section A') !== -1 && text.indexOf('Section B') !== -1 && text.indexOf('awaiting marking') !== -1, 'sections, and answers awaiting marking');
    assert(flat.indexOf('Answer given: Bevel each edge to 30\u00b0 so the V is 60\u00b0, leave a 2 mm root face') !== -1, 'an essay as she wrote it');
    assert(text.indexOf('Tameka Richards') !== -1 && text.indexOf('From home, not invigilated') !== -1, 'her details; sat from home, not invigilated');
  }

  console.log('Her own copy before the answers are released');
  {
    const s = S.theory1();
    const A = require('../cestis-core.js').assessments;
    const m = A.theoryModel({ exam: s.exam, result: s.result, questions: s.exam.questionData, student: S.PEOPLE[0], revealAnswers: false, centreName: S.CENTRE, offset: S.OFF });
    const { text } = textOf(P.render(m, deps()));
    assert(text.indexOf('The right answers are not shown on this copy') !== -1 && text.indexOf('correct answer') === -1, 'no right answers on her copy, and it says why');
    assert(text.indexOf('answer given · correct') !== -1, '...yet an answer of hers that scored is marked right, as its marks say');
  }

  console.log('A marked group Practical with 7 photos, two to a page');
  {
    const s = S.practical();
    const photos = {};
    s.model.photos.forEach((p, i) => { photos[p.id] = i === 3 ? { data: fx('photo-portrait.jpg'), w: 240, h: 320 } : { data: fx('photo-landscape.jpg'), w: 320, h: 240 }; });
    photos[s.model.photos[6].id] = null;   // one this computer could not read
    const doc = P.render(s.model, deps({ photos }));
    const { raw, text } = textOf(doc);
    const n = doc.getNumberOfPages();
    assert(text.indexOf('Assessment record · Practical (group)') !== -1 && text.indexOf('Group B') !== -1, 'Assessment record · Practical (group), Group B');
    ['Kemar Johnson', 'Tameka Richards', 'Damion Lewis', 'Nadine Bailey'].forEach(nm => assert(text.indexOf(nm) !== -1, 'member ' + nm));
    assert(text.indexOf('Not yet competent: Root pass not shown') !== -1 && (text.match(/^Competent$/gm) || []).length === 3, 'a result for each member');
    assert(text.indexOf('What the assessor checked') !== -1 && text.indexOf('Performance criteria') !== -1, 'what the assessor checked');
    assert(text.indexOf('Steady arc and equal legs') !== -1, 'the assessor\'s comment');
    assert(text.indexOf('Not yet signed') !== -1 && (text.match(/Electronically signed by/g) || []).length === 3, 'three members signed, one "Not yet signed"');
    ['Administrator', 'Assessor', 'Programme Coordinator'].forEach(r => assert(text.indexOf(r) !== -1, 'a block for the ' + r));
    const photoPages = Math.ceil(7 / 2);
    assert(text.indexOf('Photos 1–2 of 7') !== -1 && text.indexOf('Photos 7 of 7') !== -1, 'photos two to a page (' + n + ' pages)');
    assert((raw.match(/\/Subtype \/Image/g) || []).length === 1 + 6, 'six photos drawn (one could not be read) and the crest');
    assert(text.indexOf('This photo could not be read on this computer') !== -1, 'a photo that could not be read says so, never a blank');
    assert(text.indexOf('1.  Station set up, every member in PPE') !== -1 && text.indexOf('Added by Kemar Johnson, 29 Oct 2026, 13:00') !== -1, 'each photo with its caption, who added it and when');
    assert(n >= photoPages + 1, 'the photo pages follow the record');
    // Each photo about half a page: the photo box is at least 110 mm tall.
    const page2 = doc.internal.pages[n - photoPages + 1].join('\n');
    const m = /([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm/.exec(page2);
    assert(m && Number(m[2]) / 72 * 25.4 > 95, 'a photo is drawn about half an A4 page tall (' + (m ? Math.round(Number(m[2]) / 72 * 25.4) + ' mm' : '?') + ')');
  }

  console.log('A member\'s own copy of the practical');
  {
    const s = S.practical();
    const A = require('../cestis-core.js').assessments;
    const m = A.practicalModel({ exam: s.exam, group: s.group, work: s.work, students: s.students, centreName: S.CENTRE, offset: S.OFF, memberOnly: S.PEOPLE[3].id });
    const { text } = textOf(P.render(m, deps({ photos: {} })));
    assert(text.indexOf('NOT YET COMPETENT') !== -1 && text.indexOf('Root pass not shown') !== -1, 'her result and comment');
    assert(text.indexOf('Steady arc and equal legs') === -1 && text.indexOf('Clean, even beads') === -1 && (text.match(/Electronically signed by/g) || []).length === 0, 'nobody else\'s comment or signature');
  }

  console.log('Several papers as one PDF, for printing');
  {
    const a = new Uint8Array(P.render(S.theory1().model, deps({ compress: true })).output('arraybuffer'));
    const b = new Uint8Array(P.render(S.theory2().model, deps({ compress: true })).output('arraybuffer'));
    const c = new Uint8Array(P.render(S.practical().model, deps({ compress: true, photos: {} })).output('arraybuffer'));
    const pages = await Promise.all([a, b, c].map(x => PDFLib.PDFDocument.load(x).then(d => d.getPageCount())));
    const joined = await P.combine([a, b, c], PDFLib);
    const total = (await PDFLib.PDFDocument.load(joined)).getPageCount();
    assert(total === pages[0] + pages[1] + pages[2], 'three papers, every page, in order (' + total + ' pages)');
  }

  console.log('Characters a PDF\'s plain fonts cannot write');
  {
    assert(P.pdfText('≥ 4 → ok °C – — ’') === '>= 4 -> ok °C – — ’', 'written the nearest plain way, Western characters kept');
    assert(P.pdfText('emoji 😀 x') === 'emoji ? x', 'anything else becomes a question mark, never garbage');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
