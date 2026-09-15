/* The School Fee page: dialogs that reopen, totals for the present group, and a
   way back to last year.

   1. EVERY DIALOG ON THE PAGE WORKED ONCE, THEN DIED. closeModal() removed the
      `active` class AND set an inline display:none. An inline style outranks a
      stylesheet rule, so `.modal.active { display:flex }` could never show that
      dialog again: the class went on and nothing happened. That is why the Edit
      and Delete buttons in Fee Structure appeared to stop working — they worked
      on the first press of the session and never again.

   2. THE TOTALS MIXED THE YEARS. The scope control offered only "All Quarters",
      which silently meant EVERY YEAR at once and was the default, or a single
      quarter. There was no way to ask for this financial year, which is what the
      Centre means by the present group, so last year's cohort was folded into
      every card and the only way to narrow it was one quarter in isolation.

   3. THERE WAS NO WAY BACK TO LAST YEAR. The year arrows existed but were dimmed
      whenever "All Quarters" was on — the default — so the one control for
      stepping back to enter last year's arrears looked broken most of the time.

   Run: node tests/school-fee-ui.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const ROOT = path.join(__dirname, '..');
const PAGES = ['School.Fee.html', 'Offline System/School.Fee.html'];
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

function extractFunction(src, name, where) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(where + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

/* ---------- 1. Dialogs reopen ---------- */
console.log('A dialog can be opened, closed and opened again');

PAGES.forEach(where => {
  const src = read(where);

  assert(/function openModal\(modalId\)/.test(src),
    where + ': there is one way to open a dialog');
  const close = extractFunction(src, 'closeModal', where);
  assert(!/style\.display = 'none'/.test(close),
    where + ': closing no longer leaves an inline display:none, which outranked the stylesheet and killed the dialog');
  assert(/style\.display = '';/.test(close),
    where + ': it clears the inline style instead, so the class alone decides');
  const open = extractFunction(src, 'openModal', where);
  assert(/style\.display = '';/.test(open) && /classList\.add\('active'\)/.test(open),
    where + ': opening clears any inline style left by older code, then adds the class');

  /* No `.modal` may be opened by setting an inline display any more: that is the
     half of the pair that caused the problem. The two-factor overlays are a
     different class that defaults to display:flex and manages its own inline
     display at BOTH ends, so they are left alone. */
  const inlineOpens = (src.match(/getElementById\('(\w+)'\)\.style\.display = 'flex'/g) || [])
    .map(m => (m.match(/'(\w+)'/) || [])[1])
    .filter(id => new RegExp('id="' + id + '"[^>]*class="modal"').test(src));
  assert(inlineOpens.length === 0,
    where + ': no .modal dialog is opened by inline style any more (found: ' + inlineOpens.join(', ') + ')');

  // Behaviour, with a real element.
  const el = { classList: new Set(), style: { display: 'none' } };
  const node = {
    classList: { add: c => el.classList.add(c), remove: c => el.classList.delete(c),
                 contains: c => el.classList.has(c) },
    style: el.style
  };
  const sb = { document: { getElementById: () => node } };
  vm.createContext(sb);
  vm.runInContext(open + '\n' + close, sb);
  vm.runInContext("openModal('m')", sb);
  assert(el.classList.has('active') && el.style.display === '',
    where + ': opening marks it active with nothing inline in the way');
  vm.runInContext("closeModal('m')", sb);
  assert(!el.classList.has('active') && el.style.display === '',
    where + ': closing unmarks it and leaves nothing inline behind');
  vm.runInContext("openModal('m')", sb);
  assert(el.classList.has('active') && el.style.display === '',
    where + ': and it opens again — the second press used to do nothing');
});

/* ---------- 2. The present group, not every year ---------- */
console.log('The figures show the present group by default');

PAGES.forEach(where => {
  const src = read(where);

  assert(/let feeScopeMode = 'year';/.test(src),
    where + ': the page opens on the selected financial year — the present group');
  assert(src.indexOf("let feeShowAllPayments = true;") === -1,
    where + ': the old default of every-year-at-once is gone');
  assert(/function feeSelectYear\(\)/.test(src), where + ': there is a whole-year scope to choose');
  assert(/function feeSelectQuarter\(q\)/.test(src), where + ': a single quarter is still available');
  assert(/function feeSelectAll\(\)/.test(src), where + ': and every year, as a deliberate choice');

  // The payment filter must accept the whole year, not just one quarter of it.
  const fn = extractFunction(src, 'paymentInActiveQuarter', where);
  assert(/feeScopeMode === 'year'/.test(fn) && /dqY\.fy === curY\.fy/.test(fn),
    where + ': under the year scope a payment counts when it falls in that financial year');
  assert(/feeScopeMode === 'all'/.test(fn),
    where + ': every year is still reachable');

  const stu = extractFunction(src, 'studentInActiveFY', where);
  assert(/feeScopeMode === 'all'/.test(stu),
    where + ': the trainee count follows the same three scopes');

  // The cards say which scope they are showing.
  const lbl = extractFunction(src, 'feeScopeLabel', where);
  assert(/all four quarters/.test(lbl), where + ': a whole-year view says so');
  assert(/whole history/.test(lbl), where + ': and an every-year view says that instead');
  const fyl = extractFunction(src, 'feeFYLabel', where);
  assert(/group/.test(fyl), where + ': the trainee cards name the group they are counting');
});

/* ---------- 3. Going back a year, and getting home ---------- */
console.log('Last year is one button away, and so is the way back');

PAGES.forEach(where => {
  const src = read(where);

  assert(/Previous year/.test(src) && /Next year/.test(src),
    where + ': the year control is labelled in words, not a bare arrow');
  assert(src.indexOf("fee-fy-idle") === -1,
    where + ': it is never dimmed — it used to be greyed out whenever the default scope was on');
  assert(/function feeCurrentFY\(\)/.test(src),
    where + ': the page knows which financial year today falls in');
  assert(/function feeReturnToPresent\(\)/.test(src),
    where + ': and there is one step back to the present group');

  const ret = extractFunction(src, 'feeReturnToPresent', where);
  assert(/feeScopeMode = 'year';/.test(ret),
    where + ': returning lands on the whole present year, not a stray quarter');
  assert(/setActiveQuarter\(fy,/.test(ret),
    where + ': and actually moves the shared year, so the other pages follow');

  assert(/not the present group/.test(src),
    where + ': while a past year is selected the bar says so plainly');
  assert(/fee-fy-past/.test(src),
    where + ': and the year itself is flagged');
});

/* ---------- 4. The interface ---------- */
console.log('The page starts at the top and the table is readable');

PAGES.forEach(where => {
  const src = read(where);

  // The banner used to be a 120px crest stacked over four centred lines.
  assert(/\.header-logo \{[\s\S]{0,120}max-width: 56px;/.test(src),
    where + ': the crest is a compact size');
  assert((src.match(/max-width: 120px;\n            margin: 0 auto 1rem;/g) || []).length === 0,
    where + ': and the later rule that re-inflated it is gone');
  assert(/\.header \{[\s\S]{0,400}display: flex;/.test(src),
    where + ': the header is one row rather than a stack');
  assert(/\.header-controls \{/.test(src),
    where + ': with the account and Cloud controls at the end of it');

  // Eight tabs stranded one on a second row.
  assert(/\.nav-tab \{[\s\S]{0,400}flex: 1 1 auto;/.test(src),
    where + ': the tabs share the width instead of orphaning the last one');

  // Nine term columns for three-term programmes.
  assert(/class="fee-term-col" data-term="1"/.test(src),
    where + ': the term columns are addressable');
  assert(/let termsInUse = 0;/.test(src),
    where + ': the page works out how many terms are actually used');
  assert(/\(n > termsInUse\) \? 'none' : ''/.test(src),
    where + ': and hides the rest, so the real columns are not squeezed');

  // Four identical green cards.
  assert(/\.stat-card:nth-child\(3\) \.value \{ color: #1b8a5a; \}/.test(src),
    where + ': collected and outstanding are told apart at a glance');
  assert(/div\[id\$="Scope"\]/.test(src),
    where + ': and the line saying which group and period is legible');

  // The banner covered the header controls.
  assert(/bottom:18px;/.test(src),
    where + ': the records warning sits clear of the account and Cloud controls');

  assert(src.indexOf('height:380px') === -1 && /height:300px/.test(src),
    where + ': the charts no longer push the figures off the screen');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
