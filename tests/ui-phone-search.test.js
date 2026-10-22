/* Search on phones.

   What was wrong (the UI audit, "Search on phones"): below 768px the top
   bar's search box was simply hidden (`.topbar-search { display:none }`), so
   on a phone nobody — administrator, instructor or trainee — could search at
   all.

   Now a magnifier button in the bar opens the same box across the whole bar
   with its results below (the same role-scoped results, initGlobalSearch).
   It folds away on its ✕, on Escape, on picking a result and on the phone's
   Back button (opening adds one history step; closing any other way takes it
   back). On a computer the button is never shown and the box is unchanged.

   Pinned here from the real index.html (Node, no browser); the browser suite
   tests/browser/ui-preview-a.js drives it for real at 390px and 1366px.

   Run: node tests/ui-phone-search.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
function attrsOf(tag) {
  const a = {};
  const rx = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g; let m;
  while ((m = rx.exec(tag))) a[m[1].toLowerCase()] = m[2];
  return a;
}
// The body of the first @media(max-width:768px) block that contains `needle`.
function mediaBlockWith(needle) {
  const rx = /@media\s*\(max-width:\s*768px\)\s*\{/g; let m;
  while ((m = rx.exec(INDEX))) {
    let depth = 0, i = INDEX.indexOf('{', m.index);
    for (; i < INDEX.length; i++) {
      if (INDEX[i] === '{') depth++;
      else if (INDEX[i] === '}') { depth--; if (!depth) break; }
    }
    const body = INDEX.slice(m.index, i + 1);
    if (body.indexOf(needle) >= 0) return body;
  }
  return '';
}

console.log('The top bar carries a labelled search button for phones');
{
  const tag = (INDEX.match(/<button[^>]*id="globalSearchToggle"[^>]*>/) || [''])[0];
  const a = attrsOf(tag);
  assert(!!tag, 'there is a #globalSearchToggle button');
  assert(a.type === 'button' && a['aria-label'] === 'Search' && a['aria-controls'] === 'globalSearch' && a['aria-expanded'] === 'false',
    'it is a real button named "Search" that controls #globalSearch and says it starts closed: ' + tag);
  assert(/onclick="openPhoneSearch\(\)"/.test(tag), 'and it opens the phone search');
  const bar = INDEX.slice(INDEX.indexOf('<header class="topbar">'), INDEX.indexOf('</header>', INDEX.indexOf('<header class="topbar">')));
  assert(bar.indexOf('id="globalSearchToggle"') > 0, 'it sits in the top bar');
  const input = (bar.match(/<input[^>]*id="globalSearch"[^>]*>/) || [''])[0];
  assert(/aria-label="[^"]+"/.test(input), 'the search box has an accessible name (placeholder text is not one): ' + input);
  const close = (bar.match(/<button[^>]*class="topbar-search-close"[^>]*>/) || [''])[0];
  assert(/aria-label="Close search"/.test(close) && /onclick="closePhoneSearch\(\)"/.test(close), 'a labelled ✕ closes it: ' + close);
}

console.log('A computer never shows the phone buttons; a phone does, and the open box spans the bar');
{
  assert(/\.topbar \.topbar-search-toggle, \.topbar-search \.topbar-search-close \{ display:none; \}/.test(INDEX),
    'outside the phone rules both phone buttons are hidden (and win over .topbar-btn\'s display:flex)');
  const m = mediaBlockWith('.topbar-search-toggle');
  assert(!!m, 'the phone rules (max-width:768px) mention the toggle');
  assert(/\.topbar \.topbar-search-toggle \{ display:flex; width:44px; height:44px; \}/.test(m), 'on a phone the button shows, 44x44');
  assert(/\.topbar-search \{ display:none; \}/.test(m), 'the folded box stays hidden until opened');
  assert(/\.topbar\.search-open \.topbar-search \{[^}]*position:absolute; inset:0;/.test(m), 'opened, the box covers the bar edge to edge');
  assert(/\.topbar\.search-open \.search-results \{[^}]*top:100%; left:0; right:0;/.test(m), 'and the results fill the width below it');
  assert(/\.topbar\.search-open \.topbar-search input \{[^}]*font-size:16px;/.test(m), 'the box text is 16px, so phones do not zoom in on it');
}

console.log('Escape and a picked result fold it away');
{
  const init = extractFunction(INDEX, 'initGlobalSearch');
  assert(/if\(e\.key==='Escape'\) \{ dropdown\.classList\.remove\('active'\); closePhoneSearch\(\); \}/.test(init), 'Escape in the box closes the phone search');
  assert(/search-result-item" onclick="showPage\('\$\{escapeAttr\(r\.page\)\}'\);[^"]*closePhoneSearch\(true\);"/.test(init), 'picking a result closes it (the page name still escaped)');
  assert(/CESTISCore\.sessionAccess\.searchPool\(currentRole/.test(init), 'the results are still only what the role may see');
  assert(/window\.addEventListener\('popstate', function\(\) \{ closePhoneSearch\(false, true\); \}\);/.test(INDEX), 'the Back button closes it');
}

console.log('Opening adds one history step; closing gives it back; Back does not go further');
{
  const src = extractFunction(INDEX, 'openPhoneSearch') + '\n' + extractFunction(INDEX, 'closePhoneSearch');
  function makeEnv() {
    const cls = new Set();
    const attrs = { 'aria-expanded': 'false' };
    const log = [];
    const env = {
      focused: null, log,
      bar: { classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) } },
      input: { value: 'Rom', focus() { env.focused = 'input'; } },
      toggle: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: k => attrs[k], focus() { env.focused = 'toggle'; } },
      dd: { classList: { remove: () => log.push('dd-hide') } },
      history: { state: null, pushState(s) { log.push('push'); this.state = s; }, back() { log.push('back'); this.state = null; } }
    };
    env.ctx = vm.createContext({
      document: { querySelector: s => s === '.topbar' ? env.bar : null,
        getElementById: id => ({ globalSearch: env.input, globalSearchToggle: env.toggle, searchResults: env.dd })[id] || null },
      history: env.history
    });
    vm.runInContext(src, env.ctx);
    return env;
  }
  let e = makeEnv();
  vm.runInContext('openPhoneSearch()', e.ctx);
  assert(e.bar.classList.contains('search-open') && e.toggle.getAttribute('aria-expanded') === 'true' && e.focused === 'input', 'opening shows the box, says so, and puts the cursor in it');
  assert(e.log.join() === 'push' && e.history.state && e.history.state.cestisPhoneSearch, 'and adds exactly one history step');
  vm.runInContext('openPhoneSearch()', e.ctx);
  assert(e.log.join() === 'push', 'a second tap while open adds nothing');
  vm.runInContext('closePhoneSearch()', e.ctx);
  assert(!e.bar.classList.contains('search-open') && e.toggle.getAttribute('aria-expanded') === 'false', 'closing folds it away and says so');
  assert(e.focused === 'toggle' && e.input.value === '', 'focus goes back to the button and the box is emptied');
  assert(e.log.join() === 'push,dd-hide,back', 'and the history step is taken back');
  vm.runInContext('closePhoneSearch()', e.ctx);
  assert(e.log.join() === 'push,dd-hide,back', 'closing when already closed does nothing (a computer never gets here)');

  e = makeEnv();
  vm.runInContext('openPhoneSearch(); closePhoneSearch(false, true)', e.ctx);
  assert(e.log.join() === 'push,dd-hide' && !e.bar.classList.contains('search-open'), 'Back (the step already gone) closes it without going back again');
  e = makeEnv();
  vm.runInContext('openPhoneSearch(); closePhoneSearch(true)', e.ctx);
  assert(e.focused === 'input' && e.log.join() === 'push,dd-hide,back', 'a picked result closes it without pulling focus to the button');
  e = makeEnv();
  e.history.state = { somethingElse: 1 };
  vm.runInContext('document.querySelector(".topbar").classList.add("search-open"); closePhoneSearch()', e.ctx);
  assert(e.log.indexOf('back') === -1, 'it never goes back past a history step it did not add');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
