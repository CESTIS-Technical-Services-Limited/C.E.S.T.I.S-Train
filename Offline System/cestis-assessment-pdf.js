/* ============================================================================
   cestis-assessment-pdf.js — the printable record of a completed assessment.

   The owner (31 October 2026): "the completed assessment as a PDF, A4 and
   professional" — the Centre's crest and full name, "Assessment record ·
   Theory/Practical", a document number, the trainee's details, the unit and
   the assessment, the times and any extra time, where it was sat, the result
   box, every question with her answer, the right answer and the marks, the
   marker's comments, the signature blocks (names left blank, to complete by
   hand), her electronic signature in a handwritten style, page numbers and a
   footer saying where it is filed. A group practical: every member's result,
   what the assessor checked, and the photos two to a page, each about half a
   page, with its caption, who added it and when.

   WHAT IS HERE: only the layout. What the record says is worked out by
   CESTISCore.assessments.theoryModel / practicalModel (pure, tested in Node);
   this file draws a model with jsPDF (vendor/jspdf-2.5.1) and joins several
   PDFs into one with pdf-lib (vendor/pdf-lib-1.17.1) for printing.

     CESTISAssessPdf.render(model, deps) -> a jsPDF document
       deps: { jsPDF, font (the signature font, a base64 TTF — vendor/fonts),
               crest (a data: URL), photos { photoId: { data (data: URL),
               w, h } } }
     CESTISAssessPdf.combine([bytes…], PDFLib) -> Promise<Uint8Array>
     CESTISAssessPdf.assets(fetchFn) -> Promise<{ font, crest }>  (browser:
               this site's own copies, fetched once and kept for the page)

   Runs in a browser and in Node (tests/assessment-pdf.test.js).
   ============================================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CESTISAssessPdf = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FONT_URL = 'vendor/fonts/GreatVibes-Regular-latin.ttf';
  var CREST_URL = 'assessments/assets/crest-small.jpg';
  var SCRIPT = 'GreatVibes';

  // A4, in millimetres.
  var PAGE = { w: 210, h: 297, m: 16, top: 38, bottom: 18 };
  var INK = [26, 32, 44], MUTED = [96, 104, 118], LINE = [200, 206, 214], SOFT = [244, 246, 249];
  var GREEN = [24, 120, 64], RED = [178, 40, 36], AMBER = [176, 108, 0];
  var TONE = { pass: GREEN, fail: RED, provisional: AMBER };

  /* Helvetica in a PDF knows the Western (Windows-1252) characters only:
     anything else is written the nearest plain way. */
  var SWAP = { '≤': '<=', '≥': '>=', '←': '<-', '→': '->', '✓': 'yes', '✗': 'no', '✕': 'x',
    '−': '-', '‑': '-', '‐': '-', ' ': ' ', ' ': ' ', ' ': ' ', '≈': '~', '′': "'", '″': '"',
    'Ω': 'ohm', 'µ': 'u', '⁰': '0', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
  var CP1252 = /[ -~ -ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ\n]/;
  function pdfText(s) {
    s = String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (SWAP[ch] != null) out += SWAP[ch];
      else if (CP1252.test(ch)) out += ch;
      else if (/[\ud800-\udbff]/.test(ch)) { i++; out += '?'; }
      else out += '?';
    }
    return out;
  }

  /* ---- The page machinery ---------------------------------------------- */
  function Writer(doc, model, deps) {
    this.doc = doc; this.model = model; this.deps = deps || {};
    this.y = PAGE.top; this.width = PAGE.w - 2 * PAGE.m;
    this.hasScript = false;
  }
  Writer.prototype.color = function (c) { this.doc.setTextColor(c[0], c[1], c[2]); };
  Writer.prototype.font = function (style, size) { this.doc.setFont('helvetica', style || 'normal'); this.doc.setFontSize(size || 9.5); };
  Writer.prototype.lines = function (text, width) { return this.doc.splitTextToSize(pdfText(text), width || this.width); };
  Writer.prototype.lineH = function (size) { return (size || 9.5) * 0.3528 * 1.32; };
  Writer.prototype.newPage = function () {
    this.doc.addPage();
    this.y = PAGE.top;
    this.watermark();
  };
  Writer.prototype.room = function (h) { if (this.y + h > PAGE.h - PAGE.bottom - 4) { this.newPage(); return false; } return true; };
  Writer.prototype.watermark = function () {
    if (!this.model.provisional) return;
    var d = this.doc;
    d.saveGraphicsState && d.saveGraphicsState();
    d.setFont('helvetica', 'bold'); d.setFontSize(64); d.setTextColor(244, 233, 210);
    d.text('PROVISIONAL', PAGE.w / 2, PAGE.h / 2 + 10, { align: 'center', angle: 35 });
    d.restoreGraphicsState && d.restoreGraphicsState();
  };
  /* Text that may run onto the next page, line by line. */
  Writer.prototype.para = function (text, o) {
    o = o || {};
    var size = o.size || 9.5, x = PAGE.m + (o.indent || 0), w = this.width - (o.indent || 0) - (o.right || 0);
    this.font(o.style || 'normal', size); this.color(o.color || INK);
    var ls = this.lines(text, w), lh = this.lineH(size);
    for (var i = 0; i < ls.length; i++) {
      if (!this.room(lh)) { this.font(o.style || 'normal', size); this.color(o.color || INK); }
      this.doc.text(ls[i], x, this.y + lh * 0.78);
      this.y += lh;
    }
    if (o.after) this.y += o.after;
    return ls.length;
  };

  /* Header and footer on every page, once the page count is known. */
  function frame(doc, model, deps) {
    var n = doc.getNumberOfPages();
    for (var p = 1; p <= n; p++) {
      doc.setPage(p);
      var x = PAGE.m, top = 12;
      if (deps.crest) {
        try { doc.addImage(deps.crest, 'JPEG', x, top - 2, 17, 17, 'crest', 'FAST'); x += 21; } catch (e) { /* drawn without it */ }
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(INK[0], INK[1], INK[2]);
      var name = doc.splitTextToSize(pdfText(model.centreName || 'The Centre'), 118);
      doc.text(name.slice(0, 2), x, top + 3);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text(pdfText(model.recordTitle || 'Assessment record'), x, top + 3 + Math.min(2, name.length) * 4.6 + 0.6);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(INK[0], INK[1], INK[2]);
      doc.text(pdfText(model.docNo || ''), PAGE.w - PAGE.m, top + 3, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text('Page ' + p + ' of ' + n, PAGE.w - PAGE.m, top + 8, { align: 'right' });
      if (model.provisional) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(AMBER[0], AMBER[1], AMBER[2]);
        doc.text('PROVISIONAL', PAGE.w - PAGE.m, top + 13, { align: 'right' });
      }
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.4);
      doc.line(PAGE.m, 31, PAGE.w - PAGE.m, 31);
      // Footer
      doc.line(PAGE.m, PAGE.h - 13, PAGE.w - PAGE.m, PAGE.h - 13);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      var foot = [model.footer && model.footer.made, model.footer && model.footer.filed].filter(Boolean).join(' · ');
      var fl = doc.splitTextToSize(pdfText(foot), PAGE.w - 2 * PAGE.m - 24);
      doc.text(fl.slice(0, 2), PAGE.m, PAGE.h - 9);
      doc.text('Page ' + p + ' of ' + n, PAGE.w - PAGE.m, PAGE.h - 9, { align: 'right' });
    }
  }

  /* ---- Pieces both records use ------------------------------------------ */
  function heading(w, text) {
    w.font('bold', 12.5); w.color(INK);
    var ls = w.lines(text, w.width);
    ls.forEach(function (l) { w.doc.text(l, PAGE.m, w.y + 4.4); w.y += 5.6; });
    w.y += 2;
  }
  function detailRows(w, rows) {
    var d = w.doc, labelW = 38, valW = w.width - labelW - 6, size = 9.2, lh = w.lineH(size);
    var items = rows.filter(function (r) { return r && r[1] != null && String(r[1]) !== ''; }).map(function (r) {
      w.font('normal', size);
      return { label: r[0], lines: w.lines(r[1], valW) };
    });
    var h = items.reduce(function (n, it) { return n + it.lines.length * lh + 1.4; }, 0) + 4;
    w.room(Math.min(h, 120));
    d.setFillColor(SOFT[0], SOFT[1], SOFT[2]); d.setDrawColor(LINE[0], LINE[1], LINE[2]);
    var y0 = w.y;
    d.roundedRect(PAGE.m, y0, w.width, h, 1.5, 1.5, 'FD');
    var y = y0 + 3;
    items.forEach(function (it) {
      w.font('bold', size); w.color(MUTED);
      d.text(pdfText(it.label), PAGE.m + 3, y + lh * 0.78);
      w.font('normal', size); w.color(INK);
      it.lines.forEach(function (l, i) { d.text(l, PAGE.m + 3 + labelW, y + lh * 0.78 + i * lh); });
      y += it.lines.length * lh + 1.4;
    });
    w.y = y0 + h + 4;
  }
  function resultBox(w, res) {
    if (!res) return;
    var d = w.doc, tone = TONE[res.tone] || INK;
    // The verdict's badge first: the score line takes the room it leaves.
    w.font('bold', 10.5);
    var vw = Math.min(80, d.getTextWidth(pdfText(res.verdict || '')) + 8);
    w.font('bold', 11);
    var line = w.lines(res.line || '', w.width - vw - 14).slice(0, 3);
    var h = Math.max(15, 8 + line.length * 5);
    w.room(h + 4);
    d.setDrawColor(tone[0], tone[1], tone[2]); d.setLineWidth(0.6);
    d.roundedRect(PAGE.m, w.y, w.width, h, 1.5, 1.5, 'S');
    d.setLineWidth(0.2);
    w.font('bold', 8); w.color(MUTED);
    d.text('RESULT', PAGE.m + 4, w.y + 5);
    w.font('bold', 11); w.color(INK);
    line.forEach(function (l, i) { d.text(l, PAGE.m + 4, w.y + 10.2 + i * 5); });
    // The verdict, in its colour, on the right.
    w.font('bold', 10.5);
    d.setFillColor(tone[0], tone[1], tone[2]);
    var by = w.y + (h - 7.4) / 2;
    d.roundedRect(PAGE.m + w.width - vw - 4, by, vw, 7.4, 1.2, 1.2, 'F');
    d.setTextColor(255, 255, 255);
    d.text(pdfText(res.verdict || ''), PAGE.m + w.width - 4 - vw / 2, by + 5, { align: 'center' });
    w.y += h + 5;
  }
  function tick(d, x, y, s, c) {
    d.setDrawColor(c[0], c[1], c[2]); d.setLineWidth(0.5);
    d.line(x, y - s * 0.35, x + s * 0.35, y);
    d.line(x + s * 0.35, y, x + s, y - s * 0.85);
    d.setLineWidth(0.2);
  }
  function cross(d, x, y, s, c) {
    d.setDrawColor(c[0], c[1], c[2]); d.setLineWidth(0.5);
    d.line(x, y - s, x + s * 0.8, y - s * 0.2);
    d.line(x + s * 0.8, y - s, x, y - s * 0.2);
    d.setLineWidth(0.2);
  }

  /* The trainee's signature: her name in a handwritten style on the line,
     and the line under it, in the manner of DocuSign. */
  function traineeSignature(w, label, sig, unsigned) {
    var d = w.doc, h = 24;
    w.room(h + 2);
    var y = w.y, x = PAGE.m, lw = 110;
    w.font('bold', 8.5); w.color(MUTED);
    d.text(pdfText(label), x, y + 3);
    if (sig && sig.name) {
      if (w.hasScript) { d.setFont(SCRIPT, 'normal'); d.setFontSize(23); }
      else { d.setFont('times', 'italic'); d.setFontSize(18); }
      d.setTextColor(16, 38, 92);
      d.text(pdfText(sig.name), x + 2, y + 13.2);
    } else {
      w.font('italic', 9); w.color(MUTED);
      d.text(pdfText(unsigned || 'Not yet signed'), x + 2, y + 12);
    }
    d.setDrawColor(INK[0], INK[1], INK[2]); d.setLineWidth(0.3);
    d.line(x, y + 15.5, x + lw, y + 15.5);
    d.setLineWidth(0.2);
    w.font('normal', 7.3); w.color(MUTED);
    var ls = w.lines(sig && sig.line ? sig.line : 'Trainee', w.width);
    d.text(ls.slice(0, 2), x, y + 19);
    w.y = y + h;
  }
  /* The staff's blocks: role, and blank Name / Signature / Date lines to
     complete by hand ("leave line blank, for all names"). */
  function staffBlocks(w, roles) {
    var d = w.doc, h = 34, n = roles.length, gap = 6, bw = (w.width - gap * (n - 1)) / n;
    w.room(h + 2);
    var y = w.y;
    roles.forEach(function (role, i) {
      var x = PAGE.m + i * (bw + gap);
      d.setDrawColor(LINE[0], LINE[1], LINE[2]);
      d.roundedRect(x, y, bw, h, 1.2, 1.2, 'S');
      w.font('bold', 9); w.color(INK);
      d.text(pdfText(role), x + 3, y + 5.5);
      w.font('normal', 8); w.color(MUTED);
      [['Name', 13], ['Signature', 21.5], ['Date', 30]].forEach(function (f) {
        d.text(f[0], x + 3, y + f[1]);
        d.setDrawColor(INK[0], INK[1], INK[2]); d.setLineWidth(0.25);
        d.line(x + 3 + (f[0] === 'Signature' ? 15 : 10), y + f[1] + 0.4, x + bw - 3, y + f[1] + 0.4);
        d.setLineWidth(0.2);
      });
    });
    w.y = y + h + 4;
  }

  /* ---- A theory paper --------------------------------------------------- */
  function question(w, q) {
    var d = w.doc;
    if (q.section) {
      w.room(14);
      w.y += 1.5;
      w.font('bold', 10); w.color(INK);
      w.lines(q.section, w.width).forEach(function (l) { w.room(5); d.text(l, PAGE.m, w.y + 3.6); w.y += 4.6; });
      d.setDrawColor(LINE[0], LINE[1], LINE[2]); d.line(PAGE.m, w.y + 0.5, PAGE.m + w.width, w.y + 0.5);
      w.y += 3;
    }
    // Keep a question's first lines with its number.
    w.room(16);
    var markW = 34;
    w.font('bold', 9.6); w.color(INK);
    var stem = w.lines(q.n + '.  ' + q.text, w.width - markW);
    var lh = w.lineH(9.6);
    var tone = q.outcome === 'correct' ? GREEN : q.outcome === 'incorrect' ? RED : q.outcome === 'partial' || q.outcome === 'pending' || q.outcome === 'submitted' ? AMBER : MUTED;
    w.font('bold', 9); d.setTextColor(tone[0], tone[1], tone[2]);
    d.text(pdfText(q.marks || ''), PAGE.m + w.width, w.y + lh * 0.78, { align: 'right' });
    w.font('bold', 9.6); w.color(INK);
    stem.forEach(function (l) { w.room(lh); w.font('bold', 9.6); w.color(INK); d.text(l, PAGE.m, w.y + lh * 0.78); w.y += lh; });
    w.y += 0.8;
    if (q.options) {
      var olh = w.lineH(9);
      q.options.forEach(function (o) {
        var tag = o.given && o.correct ? 'answer given · correct' : o.given ? 'answer given' : o.correct ? 'correct answer' : '';
        var tw = tag ? 34 : 0;
        w.font(o.given ? 'bold' : 'normal', 9);
        var ls = w.lines(o.letter + ')  ' + o.text, w.width - 12 - tw);
        w.room(ls.length * olh + 0.6);
        var yy = w.y;
        // The circle she filled (or not).
        d.setDrawColor(MUTED[0], MUTED[1], MUTED[2]); d.setLineWidth(0.25);
        d.circle(PAGE.m + 4, yy + olh * 0.5, 1.15, o.given ? 'FD' : 'S');
        if (o.given) { d.setFillColor(INK[0], INK[1], INK[2]); d.circle(PAGE.m + 4, yy + olh * 0.5, 1.15, 'F'); }
        w.font(o.given ? 'bold' : 'normal', 9); w.color(o.correct ? GREEN : o.given ? RED : INK);
        if (!o.correct && !o.given) w.color(INK);
        ls.forEach(function (l, i) { d.text(l, PAGE.m + 8, yy + olh * 0.78 + i * olh); });
        if (tag) {
          w.font('bold', 7.8); w.color(o.correct ? GREEN : RED);
          d.text(pdfText(tag), PAGE.m + w.width, yy + olh * 0.78, { align: 'right' });
          if (o.correct) tick(d, PAGE.m + w.width - d.getTextWidth(pdfText(tag)) - 5, yy + olh * 0.78, 3, GREEN);
          else cross(d, PAGE.m + w.width - d.getTextWidth(pdfText(tag)) - 4.5, yy + olh * 0.78, 2.6, RED);
        }
        w.y = yy + ls.length * olh + 0.4;
      });
      if (q.answer) w.para(q.answer, { indent: 8, size: 8.8, style: 'italic', color: MUTED });
    } else {
      w.para('Answer given: ' + (q.answer || ''), { indent: 4, size: 9, after: 0.4 });
      if (q.correct) w.para((q.outcome === 'pending' ? 'Expected answer: ' : 'Correct answer: ') + q.correct, { indent: 4, size: 8.8, style: 'bold', color: GREEN, after: 0.4 });
    }
    if (q.comment && q.comment.text) {
      w.para('Marker\'s comment' + (q.comment.by ? ' (' + q.comment.by + ')' : '') + ': ' + q.comment.text, { indent: 4, size: 8.8, style: 'italic', color: [40, 70, 130], after: 0.4 });
    }
    w.y += 2.6;
    d.setDrawColor(236, 239, 243); d.line(PAGE.m, w.y - 1.4, PAGE.m + w.width, w.y - 1.4);
  }
  function theory(w) {
    var m = w.model;
    heading(w, m.heading);
    detailRows(w, m.rows);
    resultBox(w, m.result);
    if (m.revealAnswers === false) {
      w.para('The right answers are not shown on this copy: they are released once the test has closed.', { size: 8.4, style: 'italic', color: MUTED, after: 2 });
    }
    (m.questions || []).forEach(function (q) { question(w, q); });
    w.y += 2;
    w.room(30 + 40);
    w.font('bold', 10); w.color(INK);
    w.doc.text('Signatures', PAGE.m, w.y + 4); w.y += 7;
    traineeSignature(w, 'Trainee', m.signatures.trainee && m.signatures.trainee.name ? m.signatures.trainee : null, m.signatures.trainee && m.signatures.trainee.unsigned);
    w.y += 2;
    staffBlocks(w, m.signatures.staff || []);
  }

  /* ---- A group practical ------------------------------------------------ */
  function membersTable(w, members) {
    var d = w.doc, cols = [0.4, 0.22, 0.38], size = 9, lh = w.lineH(size);
    w.room(14);
    var y = w.y, x = PAGE.m;
    d.setFillColor(SOFT[0], SOFT[1], SOFT[2]); d.rect(x, y, w.width, 6.5, 'F');
    w.font('bold', 8.5); w.color(MUTED);
    ['Group member', 'ID', 'Result'].forEach(function (t, i) {
      var cx = x + w.width * cols.slice(0, i).reduce(function (a, b) { return a + b; }, 0);
      d.text(t, cx + 2, y + 4.5);
    });
    w.y = y + 7.5;
    members.forEach(function (m) {
      w.font('normal', size);
      var rl = m.result ? w.lines(m.result, w.width * cols[2] - 4) : [''];
      var h = Math.max(1, rl.length) * lh + 2;
      w.room(h);
      var yy = w.y;
      w.font('bold', size); w.color(INK);
      d.text(pdfText(m.name), x + 2, yy + lh * 0.78);
      w.font('normal', size); w.color(MUTED);
      d.text(pdfText(m.id), x + w.width * cols[0] + 2, yy + lh * 0.78);
      w.color(m.outcome === 'competent' ? GREEN : m.outcome === 'nyc' ? RED : m.result ? AMBER : MUTED);
      w.font(m.outcome ? 'bold' : 'normal', size);
      rl.forEach(function (l, i) { d.text(l, x + w.width * (cols[0] + cols[1]) + 2, yy + lh * 0.78 + i * lh); });
      w.y = yy + h;
      d.setDrawColor(236, 239, 243); d.line(x, w.y - 0.6, x + w.width, w.y - 0.6);
    });
    w.y += 4;
  }
  function checklistMatrix(w, m) {
    var d = w.doc, shown = m.members.filter(function (x) { return x.checks; });
    if (!m.checklist.length || !shown.length) return;
    w.room(20);
    w.font('bold', 10); w.color(INK);
    d.text('What the assessor checked', PAGE.m, w.y + 4); w.y += 7;
    var colW = Math.min(18, (w.width * 0.45) / shown.length), textW = w.width - colW * shown.length - 4;
    var x0 = PAGE.m + textW + 4;
    d.setFillColor(SOFT[0], SOFT[1], SOFT[2]); d.rect(PAGE.m, w.y, w.width, 6.5, 'F');
    w.font('bold', 8); w.color(MUTED);
    d.text('Performance criteria', PAGE.m + 2, w.y + 4.5);
    shown.forEach(function (mem, i) {
      var ini = mem.name.split(/\s+/).filter(Boolean);
      var label = ini.length ? (ini[0].charAt(0) + (ini.length > 1 ? ini[ini.length - 1].charAt(0) : '')).toUpperCase() : '?';
      d.text(label, x0 + i * colW + colW / 2, w.y + 4.5, { align: 'center' });
    });
    w.y += 7.5;
    var lh = w.lineH(9);
    m.checklist.forEach(function (c, ci) {
      w.font('normal', 9);
      var ls = w.lines(c, textW - 2);
      var h = ls.length * lh + 1.8;
      w.room(h);
      w.color(INK);
      ls.forEach(function (l, i) { d.text(l, PAGE.m + 2, w.y + lh * 0.78 + i * lh); });
      shown.forEach(function (mem, i) {
        var v = mem.checks[ci], cx = x0 + i * colW + colW / 2 - 1.5, cy = w.y + lh * 0.78;
        if (v === 'met') tick(d, cx, cy, 3, GREEN);
        else if (v === 'not') cross(d, cx + 0.2, cy, 2.6, RED);
        else { w.font('normal', 9); w.color(MUTED); d.text('-', cx + 1.5, cy, { align: 'center' }); }
      });
      w.y += h;
      d.setDrawColor(236, 239, 243); d.line(PAGE.m, w.y - 0.6, PAGE.m + w.width, w.y - 0.6);
    });
    w.font('normal', 7.6); w.color(MUTED);
    var key = shown.map(function (mem) { var p = mem.name.split(/\s+/).filter(Boolean); return (p[0] ? p[0].charAt(0) : '') + (p.length > 1 ? p[p.length - 1].charAt(0) : '') + ' = ' + mem.name; }).join('   ');
    w.lines(key + '   (tick = met, cross = not met, - = not marked yet)', w.width).forEach(function (l) { w.room(4); d.text(l, PAGE.m, w.y + 3); w.y += 3.6; });
    w.y += 3;
    var comments = shown.filter(function (mem) { return mem.comment; });
    if (comments.length) {
      w.font('bold', 9.4); w.color(INK); w.room(8);
      d.text('The assessor\'s comments', PAGE.m, w.y + 3.6); w.y += 6;
      comments.forEach(function (mem) {
        w.para(mem.name + (mem.assessor ? ' (' + mem.assessor + ')' : '') + ': ' + mem.comment, { size: 8.8, style: 'italic', color: [40, 70, 130], after: 0.8 });
      });
      w.y += 2;
    }
  }
  function photoPages(w, m) {
    var photos = m.photos || [], d = w.doc, deps = w.deps;
    if (!photos.length) return;
    for (var i = 0; i < photos.length; i += 2) {
      w.newPage();
      w.font('bold', 10); w.color(INK);
      d.text('Photos ' + (i + 1) + (photos[i + 1] ? '–' + (i + 2) : '') + ' of ' + photos.length, PAGE.m, w.y + 3.5);
      w.y += 6;
      var slotH = (PAGE.h - PAGE.bottom - 6 - w.y - 6) / 2;
      [photos[i], photos[i + 1]].forEach(function (ph, k) {
        if (!ph) return;
        var top = w.y + k * (slotH + 6), boxH = slotH - 12, boxW = w.width;
        var img = deps.photos && deps.photos[ph.id];
        d.setDrawColor(LINE[0], LINE[1], LINE[2]);
        if (img && img.data && img.w > 0 && img.h > 0) {
          var s = Math.min(boxW / img.w, boxH / img.h), iw = img.w * s, ih = img.h * s;
          try {
            var fmt = /^data:image\/png/i.test(img.data) ? 'PNG' : 'JPEG';
            d.addImage(img.data, fmt, PAGE.m + (boxW - iw) / 2, top + (boxH - ih) / 2, iw, ih, 'ph-' + ph.id, 'FAST');
          } catch (e) { img = null; }
        }
        if (!img || !img.data) {
          d.setFillColor(SOFT[0], SOFT[1], SOFT[2]); d.rect(PAGE.m, top, boxW, boxH, 'FD');
          w.font('italic', 9); w.color(MUTED);
          d.text('This photo could not be read on this computer. It is kept at full size in the group\'s folder.', PAGE.m + boxW / 2, top + boxH / 2, { align: 'center' });
        }
        w.font('bold', 9.4); w.color(INK);
        d.text(pdfText((i + k + 1) + '.  ' + ph.caption), PAGE.m, top + boxH + 5);
        w.font('normal', 8.4); w.color(MUTED);
        d.text(pdfText('Added by ' + ph.by + (ph.at ? ', ' + ph.at : '') + (ph.late ? ' — added after the hand-in' : '')), PAGE.m, top + boxH + 9.4);
      });
    }
  }
  function practical(w) {
    var m = w.model, d = w.doc;
    heading(w, m.heading);
    detailRows(w, m.rows);
    if (m.result) resultBox(w, m.result);
    membersTable(w, m.members || []);
    checklistMatrix(w, m);
    if (m.brief) {
      w.font('bold', 9.4); w.color(INK); w.room(10);
      d.text('The task', PAGE.m, w.y + 3.6); w.y += 6;
      w.para(m.brief, { size: 8.8, after: 1 });
      if (m.safety && m.safety.length) w.para('Safety: ' + m.safety.join('; '), { size: 8.4, color: MUTED, after: 2 });
    }
    w.y += 2; w.room(34);
    w.font('bold', 10); w.color(INK);
    d.text('Signatures', PAGE.m, w.y + 4); w.y += 7;
    (m.members || []).filter(function (x) { return x.signature || x.notSigned; }).forEach(function (mem) {
      traineeSignature(w, 'Trainee — ' + mem.name, mem.signature, mem.notSigned || 'Not yet signed');
      w.y += 1;
    });
    w.y += 2;
    staffBlocks(w, m.signatures.staff || []);
    if (m.photos && m.photos.length) {
      w.para('Photos: ' + m.photos.length + ', two to a page on the pages that follow. Full-size copies are kept in the group\'s folder.', { size: 8.4, color: MUTED });
    }
    photoPages(w, m);
  }

  function render(model, deps) {
    deps = deps || {};
    var JsPDF = deps.jsPDF || (typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF);
    if (!JsPDF) throw new Error('jsPDF is not loaded');
    var doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: deps.compress !== false });
    try {
      doc.setProperties({ title: pdfText((model.docNo || '') + ' ' + (model.heading || '')), subject: pdfText(model.recordTitle || 'Assessment record'), creator: pdfText(model.centreName || ''), author: pdfText(model.centreName || '') });
    } catch (e) {}
    var w = new Writer(doc, model, deps);
    if (deps.font) {
      try { doc.addFileToVFS('GreatVibes-Regular.ttf', deps.font); doc.addFont('GreatVibes-Regular.ttf', SCRIPT, 'normal'); w.hasScript = true; }
      catch (e) { w.hasScript = false; }
    }
    w.watermark();
    if (model.kind === 'practical') practical(w); else theory(w);
    frame(doc, model, deps);
    return doc;
  }

  /* Several records as one PDF, to print in one go (pdf-lib). */
  function combine(list, PDFLib) {
    var L = PDFLib || (typeof window !== 'undefined' && window.PDFLib);
    if (!L) return Promise.reject(new Error('pdf-lib is not loaded'));
    return L.PDFDocument.create().then(function (out) {
      return (list || []).reduce(function (p, bytes) {
        return p.then(function () {
          return L.PDFDocument.load(bytes).then(function (src) {
            return out.copyPages(src, src.getPageIndices()).then(function (pages) { pages.forEach(function (pg) { out.addPage(pg); }); });
          });
        });
      }, Promise.resolve()).then(function () { return out.save(); });
    });
  }

  /* The signature font and the crest, from this site (never a font CDN),
     fetched once per page load. */
  var _assets = null;
  function toBase64(buf) {
    var bytes = new Uint8Array(buf), s = '', step = 0x8000;
    for (var i = 0; i < bytes.length; i += step) s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    return typeof btoa === 'function' ? btoa(s) : Buffer.from(bytes).toString('base64');
  }
  function assets(fetchFn) {
    if (_assets) return _assets;
    var f = fetchFn || (typeof fetch === 'function' ? fetch : null);
    if (!f) return Promise.resolve({ font: null, crest: null });
    var get = function (url) { return f(url).then(function (r) { if (!r.ok) throw new Error(url); return r.arrayBuffer(); }); };
    _assets = Promise.all([
      get(FONT_URL).then(toBase64, function () { return null; }),
      get(CREST_URL).then(function (b) { return 'data:image/jpeg;base64,' + toBase64(b); }, function () { return null; })
    ]).then(function (r) { if (!r[0] && !r[1]) _assets = null; return { font: r[0], crest: r[1] }; });
    return _assets;
  }

  return { render: render, combine: combine, assets: assets, pdfText: pdfText, toBase64: toBase64, FONT_URL: FONT_URL, CREST_URL: CREST_URL, PAGE: PAGE };
});
