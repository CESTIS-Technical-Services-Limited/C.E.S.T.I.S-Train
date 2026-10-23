/* Text on screen is never smaller than 12px.

   What was wrong (UI audit: "Raise muted-text contrast and minimum font
   size"): about 380 font sizes of 9-11.5px in the dashboard alone - table
   headings, captions under the stat cards, badges, chat times, form labels,
   dates - plus more in the sibling pages (Transcript/Grades, Student
   Progress, the request queue, Qual Plan, School Fee, the Cashbook, Payslip,
   Virement, Income & Expenditure, Time Tracking, PDF Workshop).

   Now, in every screen stylesheet of those pages, a size below 12px is
   raised to 12px (0.75rem). Only these stay at 11px, because 12px would not
   fit their fixed little box: the bell's 16px counter, the exam builder's 16px
   "required" dot, the % in the 36px
   attendance ring, the HOST tag in a video tile's label, the mark in a 22px
   task tick, the number in a 22px import-step circle and the gauge's
   min/max under its arc. Sizes the templates set inline are lifted by one
   `@media screen` rule per page. Printed documents keep their sizes: the
   print blocks, the documents script writes into their own window, point
   sizes, and the on-screen previews of printed documents (payslip, virement
   letter, cashbook report sheets) and the Virement live spreadsheet.

   Pinned here from the real files (Node, no browser); the browser suite
   tests/browser/ui-preview-a.js measures the rendered text.

   Run: node tests/ui-min-text-size.test.js */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PAGES = ['index.html', 'Transcript-Grades.html', 'Student-Progress.html', 'Cert-Transcript-Requests.html',
  'Qual-Plan-Curriculum.html', 'School.Fee.html', 'CESTIS.Cashbook.html', 'Staff.Clock.in.html', 'Staff.Payslip.html',
  'Virement.Request.html', 'Income.Expenditure.html', 'PDF.Workshop.html'];
const ELEVEN = ['.topbar-btn .dot', '.ess-req', '.attendance-ring .att-ring-text', '.vc-host-badge', '.adr-task-check.pending-review',
  '.import-step .step-num', '.gauge-chart .gauge-min', '.gauge-chart .gauge-max'];
const DOC = /payslip-print|payslip-preview|print-|(^|[\s.,])lp-|vlp-|report-sheet|rdoc-|fdoc-|report-footer/;
const FS = /font-size\s*:\s*([0-9]*\.?[0-9]+)\s*(px|rem|em|pt)/g;
const px = (v, u) => u === 'px' ? +v : (u === 'rem' || u === 'em') ? +v * 16 : u === 'pt' ? +v * 4 / 3 : NaN;

// The screen stylesheets of a page: <style> blocks, minus any that script
// writes into a printed document, minus @media print regions inside them.
function screenCss(src) {
  const scripts = []; let m; const sr = /<script\b[^>]*>[\s\S]*?<\/script>/g;
  while ((m = sr.exec(src))) scripts.push([m.index, m.index + m[0].length]);
  const out = []; const st = /<style[^>]*>([\s\S]*?)<\/style>/g;
  while ((m = st.exec(src))) {
    const inScript = scripts.some(([a, b]) => a < m.index && m.index < b);
    if (inScript && /<head>|<html/.test(src.slice(Math.max(0, m.index - 300), m.index))) continue;
    // Comments and the inline-size rule's attribute selectors are not sizes.
    const css = m[1].replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\[style\*="[^"]*"\]/g, '[x]'), start = m.index;
    // cut out @media print { ... }
    let i = 0, keep = '';
    const re = /@media\s+print\b[^{]*\{/g; let p;
    while ((p = re.exec(css))) {
      keep += css.slice(i, p.index);
      let depth = 1, j = p.index + p[0].length;
      for (; j < css.length && depth; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; }
      i = j; re.lastIndex = j;
    }
    keep += css.slice(i);
    out.push({ css: keep, start });
  }
  return out;
}
function selectorBefore(css, idx) {
  const open = css.lastIndexOf('{', idx);
  const from = Math.max(css.lastIndexOf('}', open), css.lastIndexOf('*/', open) + 1, css.lastIndexOf('{', open - 1));
  return css.slice(from + 1, open).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
}

console.log('No screen stylesheet sets text below 12px (bar the 11px fixed boxes)');
PAGES.forEach(f => {
  const src = read(f);
  const bad = [], eleven = [];
  screenCss(src).forEach(({ css }) => {
    let m; FS.lastIndex = 0;
    while ((m = FS.exec(css))) {
      if (m[2] === 'pt') continue;                           // paper sizes
      const size = px(m[1], m[2]);
      if (size >= 12 - 1e-9) continue;
      const sel = selectorBefore(css, m.index);
      if (DOC.test(sel)) continue;                           // previews of printed documents
      if (ELEVEN.some(e => sel.endsWith(e)) && Math.abs(size - 11) < 0.01) { eleven.push(sel); continue; }
      bad.push(sel + ' ' + m[1] + m[2]);
    }
  });
  assert(bad.length === 0, f + ': text below 12px in ' + bad.length + ' rule(s): ' + bad.slice(0, 6).join(' | '));
  if (f === 'index.html') assert(eleven.length >= 6, 'index.html: the fixed little boxes keep 11px (' + eleven.join(', ') + ')');
});

console.log('Sizes set inline in the templates are lifted on screen');
PAGES.forEach(f => {
  const src = read(f);
  const styles = []; let m; const st = /<style[^>]*>[\s\S]*?<\/style>/g;
  while ((m = st.exec(src))) styles.push([m.index, m.index + m[0].length]);
  const inline = new Set();
  FS.lastIndex = 0;
  while ((m = FS.exec(src))) {
    if (styles.some(([a, b]) => a <= m.index && m.index < b)) continue;
    if (m[2] === 'pt') continue;
    if (px(m[1], m[2]) < 12 - 1e-9) inline.add(m[1] + m[2]);
  }
  if (!inline.size) return;
  const ov = /\/\* Minimum readable text \(12px\)[\s\S]*?@media screen \{([\s\S]*?)\{ font-size:12px !important; \}\s*\}/.exec(src);
  assert(!!ov, f + ': has the screen-only rule for inline sizes');
  if (!ov) return;
  const missing = [];
  inline.forEach(v => {
    if (ov[1].indexOf('[style*="font-size:' + v + '"]') < 0 || ov[1].indexOf('[style*="font-size: ' + v + '"]') < 0) missing.push(v);
  });
  assert(missing.length === 0, f + ': every inline spelling is covered, with and without the space the browser writes back (missing: ' + missing.join(',') + ')');
});

// The shared look the sibling pages link last (cestis-theme.css) wins over
// their own table-heading sizes, so it must keep to 12px too.
if (fs.existsSync(path.join(ROOT, 'cestis-theme.css'))) {
  console.log('The shared look of the sibling pages keeps text at 12px or more');
  const css = read('cestis-theme.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const small = []; let m; FS.lastIndex = 0;
  while ((m = FS.exec(css))) if (m[2] !== 'pt' && px(m[1], m[2]) < 12 - 1e-9) small.push(m[1] + m[2]);
  assert(small.length === 0, 'cestis-theme.css: no size below 12px (found: ' + small.join(',') + ')');
}

console.log('Printed documents keep their own sizes');
{
  const cb = read('CESTIS.Cashbook.html');
  assert(/\.report-sheet table \{[^}]*font-size:\s*8\.5pt/.test(cb) && /\.rdoc-version \{[^}]*font-size:\s*7pt/.test(cb), 'the Cashbook report sheets keep their point sizes');
  const ps = read('Staff.Payslip.html');
  assert(/\.payslip-print \.ps-footer\{[^}]*font-size:\.7rem/.test(ps), 'the printed payslip keeps its footer size');
  const idx = read('index.html');
  const printDoc = idx.slice(idx.indexOf('const printDocument = `'), idx.indexOf('const printDocument = `') + 20000);
  assert(/font-size:\s*(8|9|10|11)(\.\d+)?(px|pt)/.test(printDoc), 'the dashboard\'s printed report template is untouched');
  ['Finance.Payment.Voucher.html', 'finance-docs.css'].forEach(f => {
    const s = read(f);
    let small = 0, m; FS.lastIndex = 0;
    while ((m = FS.exec(s))) if (px(m[1], m[2]) < 12 - 1e-9) small++;
    assert(small > 0, f + ' (a printed document) is left as it was');
  });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
