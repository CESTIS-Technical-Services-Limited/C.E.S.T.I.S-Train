/* The sibling apps share one look with the LMS dashboard (UI preview,
   owner's item 7).

   What was wrong: School Fee (rich blue), Clock-in (light teal), Cashbook and
   Income & Expenditure (slate and blue), Payroll (navy and blue), Virement
   and the finance documents (navy and gold) each had their own colours,
   fonts and buttons, so the Centre's tools looked like several products
   inside the dark LMS — and the bright pages were jarring at night.

   One stylesheet (cestis-theme.css), linked LAST in each page's <head>, gives
   each page's own colour variables the dashboard's values and restyles only
   the outer chrome. Pinned here: every page links it in the right place;
   it changes nothing that prints (all of it is screen-only, and the paper
   previews are excluded); it fetches nothing (an offline Centre never waits
   on it); its values are the dashboard's own; its text is readable; and the
   offline build ships it.

   Run: node tests/theme-one-look.test.js */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CSS = read('cestis-theme.css');
const INDEX = read('index.html');
const PAGES = ['School.Fee.html', 'CESTIS.Cashbook.html', 'Staff.Payslip.html', 'Staff.Clock.in.html', 'Virement.Request.html',
  'Income.Expenditure.html', 'Payments.Invoices.html', 'Finance.Invoice.html', 'Finance.Quote.html', 'Finance.Purchase.Order.html', 'Finance.Payment.Voucher.html'];

function lum(hex) {
  hex = hex.replace('#', '');
  const c = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const tok = (src, name) => { const m = new RegExp('--' + name + '\\s*:\\s*(#[0-9a-fA-F]{6})').exec(src); return m ? m[1] : null; };

/* ---------- 1. Every sibling page links it, last in its head ---------- */
console.log('Each sibling app links the shared theme as the last thing in its <head>');
PAGES.forEach(f => {
  const src = read(f);
  const head = src.slice(0, src.indexOf('\n</head>\n') + 1);
  const at = head.indexOf('<link rel="stylesheet" href="cestis-theme.css');
  assert(at !== -1, f + ' links cestis-theme.css');
  assert(at > head.lastIndexOf('</style>') && at > head.lastIndexOf('<link rel="stylesheet" href="finance-docs.css'), f + ': after the page\'s own styles, so it wins where it must');
  assert((src.match(/cestis-theme\.css/g) || []).length === 1, f + ': once');
});
assert(INDEX.indexOf('cestis-theme.css') === -1, 'the dashboard itself does not need it (its tokens are the source)');

/* ---------- 2. Nothing that prints, nothing fetched ---------- */
console.log('It changes nothing that prints, and fetches nothing');
const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const rootEnd = body.indexOf('}', body.indexOf(':root {'));
const rest = body.slice(rootEnd + 1).trim();
assert(/^@media screen \{/.test(rest) && rest.endsWith('}'), 'apart from the token block, every rule is inside @media screen');
let depth = 0, outside = false;
for (const ch of rest) { if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) outside = true; } else if (outside && ch.trim()) { break; } }
assert(depth === 0, 'its braces balance');
assert(!/@import|url\(/i.test(body), 'no @import and no url(): an offline Centre never waits on it, and nothing leaves the site');
['.paper', '.fd-paper-wrap', '.payslip-preview', '.print-page'].forEach(sel =>
  assert(body.indexOf(sel) !== -1, 'the printable "paper" previews (' + sel + ') are kept out of the field and table rules'));
assert(!/\bdisplay\s*:\s*none/.test(body.replace(/::before|::after/g, '')) || /::before, html body \.container > \.header::after \{ display: none !important; \}/.test(body),
  'it hides nothing but the old banner\'s decorative layers');

/* ---------- 3. The dashboard's values, readable ---------- */
console.log('Its values are the dashboard\'s own, and its text is readable');
const lmsRoot = INDEX.slice(INDEX.indexOf(':root {'), INDEX.indexOf('}', INDEX.indexOf(':root {')));
[['cestis-bg', 'bg-primary'], ['cestis-bg-2', 'bg-secondary'], ['cestis-card', 'bg-card'], ['cestis-card-hover', 'bg-card-hover'], ['cestis-input', 'bg-input'],
 ['cestis-accent', 'accent'], ['cestis-green', 'green'], ['cestis-red', 'red'], ['cestis-text', 'text-primary'], ['cestis-text-2', 'text-secondary'], ['cestis-muted', 'text-muted']]
  .forEach(([mine, lms]) => assert(tok(CSS, mine) && tok(CSS, mine).toLowerCase() === (tok(lmsRoot, lms) || '').toLowerCase(),
    '--' + mine + ' is the dashboard\'s --' + lms + ' (' + tok(CSS, mine) + ')'));
const card = tok(CSS, 'cestis-card'), bg = tok(CSS, 'cestis-bg'), input = tok(CSS, 'cestis-input');
[['cestis-text', 7], ['cestis-text-2', 4.5], ['cestis-muted', 4.5]].forEach(([t, min]) => {
  assert(contrast(tok(CSS, t), card) >= min, '--' + t + ' on a card: ' + contrast(tok(CSS, t), card).toFixed(2) + ':1 (at least ' + min + ')');
  assert(contrast(tok(CSS, t), bg) >= min, '--' + t + ' on the page: ' + contrast(tok(CSS, t), bg).toFixed(2) + ':1');
});
assert(contrast(tok(CSS, 'cestis-text'), input) >= 7, 'typed text in a field: ' + contrast(tok(CSS, 'cestis-text'), input).toFixed(2) + ':1');
assert(contrast('#000000', tok(CSS, 'cestis-accent')) >= 7, 'the primary buttons carry black text on the amber (' + contrast('#000000', tok(CSS, 'cestis-accent')).toFixed(2) + ':1)');
assert(/:is\(\.btn-primary, \.btn-gold, \.btn-amber, \.login-btn, \.ft-sync-btn[^{]*\{[^}]*color: #000 !important;/.test(body), 'every button drawn in the accent is given dark text (white on amber is 2:1)');
assert(/\.quarter-tab\.active[^{]*\{[^}]*color: #000 !important;/.test(body), 'and so is every tab drawn in it');

/* ---------- 4. Each page's own variables ---------- */
console.log('It works through each page\'s own colour variables');
[['CESTIS.Cashbook.html', ['bg', 'surface', 'surface2', 'text2', 'accent']], ['Income.Expenditure.html', ['bg', 'surface', 'accent']],
 ['Staff.Payslip.html', ['bg', 'surface', 'card', 'primary', 'text-dim']], ['Virement.Request.html', ['navy', 'gold', 'card', 'surface']],
 ['finance-docs.css', ['navy', 'gold', 'card']], ['Staff.Clock.in.html', ['bg-primary', 'bg-secondary', 'text-primary', 'primary-blue', 'header-gradient']],
 ['School.Fee.html', ['bg-primary', 'bg-card', 'heading-color', 'text-primary']]].forEach(([f, vars]) => {
  const src = read(f);
  vars.forEach(v => {
    assert(new RegExp('--' + v + '\\s*:').test(src), f + ' defines --' + v);
    assert(new RegExp('--' + v + ':\\s*(var\\(--cestis-|#|linear-gradient|rgba|0 4px|none)').test(body), 'the theme gives --' + v + ' the dashboard\'s value');
  });
});
assert(/html:root, html body\.dark-mode \{/.test(body), 'outranking each page\'s :root and its own dark-mode set');

/* ---------- 5. Shipped ---------- */
console.log('The Offline System ships it');
const planned = require('../tools/build-offline.js').plan();
assert(planned.has('cestis-theme.css'), 'the offline generator carries cestis-theme.css');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
