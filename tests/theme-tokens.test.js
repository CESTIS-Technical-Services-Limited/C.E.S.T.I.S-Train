/* Light and dark: the dashboard has a light theme as well as its dark one.

   What this pins (Node, no browser — tests/browser/exam-platform-preview.js
   drives the same things for real, in both themes):
     - the light theme is a token set: every colour token the dark :root
       defines has a light value in html[data-theme="light"], and nothing
       else; the sign-in page keeps the dark values;
     - the key text/background pairs read at WCAG AA in BOTH themes (4.5:1
       for text, 3:1 for the borders that mark a control and for the current
       question's outline) — composited exactly as the browser does
       (translucent tints over the surface below);
     - dark stays the default: the <head> applies Light before the first
       paint only when this device chose it;
     - the choice ('cestisTheme') belongs to this device: never in a backup
       snapshot, never in the Centre network's mirror;
     - the switches exist (top bar, Edit Profile, exam navigation panel) and
       cestisSetTheme() keeps the time clock's own dark mode working: a light
       dashboard shows the clock light, and back on dark the clock returns to
       its own choice.

   Run: node tests/theme-tokens.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

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
function block(src, opener) {
  const i = src.indexOf(opener);
  if (i < 0) return null;
  return src.slice(i + opener.length, src.indexOf('}', i));
}
function tokens(body) {
  const out = {};
  (body || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi, function (_, k, v) { out[k] = v.trim(); return ''; });
  return out;
}

/* ---- WCAG contrast, with translucent colours composited over what is below ---- */
function parse(c) {
  c = String(c).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return m[1].split('').map(h => parseInt(h + h, 16)).concat(1);
  m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].substr(i, 2), 16)).concat(1);
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) { const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  if (c === 'white') return [255, 255, 255, 1];
  throw new Error('not a colour: ' + c);
}
function over(fg, bg) { const a = fg[3]; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)).concat(1); }
function lum(rgb) {
  const c = rgb.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
// ratio(text, layer..., opaque base): layers are listed top first.
function ratio(cols) {
  let bg = parse(cols[cols.length - 1]);
  for (let i = cols.length - 2; i >= 1; i--) bg = over(parse(cols[i]), bg);
  const f = over(parse(cols[0]), bg);
  const a = lum(f), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const BUILDS = { 'index.html': read('index.html'), 'Offline System/index.html': read('Offline System/index.html') };
const INDEX = BUILDS['index.html'];
const DARK = tokens(block(INDEX, ':root {'));
const LIGHT = tokens(block(INDEX, 'html[data-theme="light"] {'));
const PIN = tokens(block(INDEX, 'html[data-theme="light"] #landingPage {'));
// Sizes and timings are the same in both themes.
const LAYOUT = ['radius', 'radius-sm', 'radius-lg', 'transition', 'sidebar-w', 'topbar-h'];

/* ---------- 1. A light value for every dark colour token ---------- */
console.log('Every dark colour token has a light value');
const darkNames = Object.keys(DARK).filter(k => LAYOUT.indexOf(k) === -1);
assert(darkNames.length >= 60, 'the dark :root still defines its colour tokens (' + darkNames.length + ')');
darkNames.forEach(k => assert(k in LIGHT, '--' + k + ' (dark ' + DARK[k] + ') has a light value'));
Object.keys(LIGHT).forEach(k => assert(k in DARK, '--' + k + ' in the light theme is also a dark token (no light-only name)'));
LAYOUT.forEach(k => assert(!(k in LIGHT), '--' + k + ' is a size or timing, the same in both themes'));
assert(Object.keys(PIN).length >= 25, 'the sign-in page pins the dark colours');
Object.keys(PIN).forEach(k => assert(PIN[k] === DARK[k], 'the sign-in page keeps dark --' + k + ' (' + PIN[k] + ' = ' + DARK[k] + ')'));
// Dark is exactly what it was: these are the literals the rules carried before they became tokens.
const WAS = { 'sidebar-bg': 'linear-gradient(180deg, #111922 0%, #0a1018 100%)', 'topbar-bg': 'rgba(12,17,23,0.85)', 'surface-2': '#222d3c',
  'input-border': 'rgba(255,255,255,0.1)', 'accent-fill': '#f0a500', 'accent-end': '#d4900a', 'on-accent': '#000', 'blue-end': '#2980b9',
  'w-02': 'rgba(255,255,255,0.02)', 'w-06': 'rgba(255,255,255,0.06)', 'w-10': 'rgba(255,255,255,0.1)', 'nav-fill': '#5d7590',
  'q-box-bg': 'rgba(52,152,219,0.10)', 'q-box-border': 'rgba(52,152,219,0.35)', 'bg-card': '#1a2332', 'text-muted': '#8293a7', accent: '#f0a500' };
Object.keys(WAS).forEach(k => assert(DARK[k] === WAS[k], 'dark --' + k + ' is still ' + WAS[k] + ' (got ' + DARK[k] + ')'));
['index.html', 'Offline System/index.html'].forEach(function (w) {
  assert(BUILDS[w].indexOf('html[data-theme="light"] {') !== -1, w + ': carries the light theme');
});

/* ---------- 2. Contrast, both themes ---------- */
console.log('Text and controls read at WCAG AA in both themes');
// [what, text/border token, layers (top first) ..., min]
const PAIRS = [
  ['body text on the page', 'text-primary', 'bg-primary', 4.5],
  ['body text on a card', 'text-primary', 'bg-card', 4.5],
  ['body text in a question box', 'text-primary', 'q-box-bg', 'bg-primary', 4.5],
  ['a selected answer', 'text-primary', 'q-selected', 'q-box-bg', 'bg-primary', 4.5],
  ['the question info box', 'text-primary', 'surface-2', 4.5],
  ['secondary text on the page', 'text-secondary', 'bg-primary', 4.5],
  ['secondary text on a card', 'text-secondary', 'bg-card', 4.5],
  ['secondary text on a hovered row', 'text-secondary', 'bg-card-hover', 4.5],
  ['secondary text in the info box', 'text-secondary', 'surface-2', 4.5],
  ['secondary text in a question box', 'text-secondary', 'q-box-bg', 'bg-primary', 4.5],
  ['helper text on the page', 'text-muted', 'bg-primary', 4.5],
  ['helper text on a card', 'text-muted', 'bg-card', 4.5],
  ['helper text on a hovered row', 'text-muted', 'bg-card-hover', 4.5],
  ['helper text in a dialog', 'text-muted', 'bg-secondary', 4.5],
  ['amber text on a card (timer warning, "not answered")', 'accent', 'bg-card', 4.5],
  ['amber text on the page', 'accent', 'bg-primary', 4.5],
  ['an amber badge', 'accent', 'accent-dim', 'bg-card', 4.5],
  ['primary button text', 'on-accent', 'accent-fill', 4.5],
  ['primary button text, gradient end', 'on-accent', 'accent-end', 4.5],
  ['the current question\'s outline', 'accent', 'bg-input', 3],
  ['green text on a card ("Correct", passed)', 'green', 'bg-card', 4.5],
  ['a green badge', 'green', 'green-dim', 'bg-card', 4.5],
  ['exam red text on a card (timer, "Incorrect", flags)', 'red-text', 'bg-card', 4.5],
  ['exam red text on a red tint', 'red-text', 'red-dim', 'bg-card', 4.5],
  ['exam red text in a question box', 'red-text', 'q-box-bg', 'bg-primary', 4.5],
  ['review: a right answer\'s tick, in its green row', 'green', 'green-dim', 'q-box-bg', 'bg-primary', 4.5],
  ['review: a wrong answer\'s cross, in its red row', 'red-text', 'red-dim', 'q-box-bg', 'bg-primary', 4.5],
  ['review: the marker\'s feedback in a question box', 'info-text', 'q-box-bg', 'bg-primary', 4.5],
  ['blue links on a card', 'blue', 'bg-card', 4.5],
  ['blue links on the page', 'blue', 'bg-primary', 4.5],
  ['orange text on a card', 'orange', 'bg-card', 4.5],
  ['a teal badge', 'teal', 'teal-dim', 'bg-card', 4.5],
  ['the marker\'s feedback', 'info-text', 'bg-card', 4.5],
  ['question type: multiple answers', 'type-multi', 'type-multi-bg', 'bg-card', 4.5],
  ['question type: matching', 'type-match', 'type-match-bg', 'bg-card', 4.5],
  ['question type: numerical', 'type-num', 'type-num-bg', 'bg-card', 4.5],
  ['an answered box in the exam navigation', 'nav-fill', 'bg-input', 3],
  ['a question box\'s border in the exam navigation', 'text-muted', 'bg-input', 3],
];
// Light also holds these; in dark they are the dashboard's long-standing
// colours (red 4.1:1, a field's border 1.3:1), left exactly as they were.
const LIGHT_ONLY = [
  ['red text on a card', 'red', 'bg-card', 4.5],
  ['a red badge', 'red', 'red-dim', 'bg-card', 4.5],
  ['a blue badge', 'blue', 'blue-dim', 'bg-card', 4.5],
  ['a purple badge', 'purple', 'purple-dim', 'bg-card', 4.5],
  ['a form field\'s border', 'input-border', 'bg-input', 3],
  ['white on a green button', '#ffffff', 'green', 4.5],
  ['white on a red button', '#ffffff', 'red', 4.5],
  ['white on a blue button', '#ffffff', 'blue', 4.5],
];
const report = [];
function check(theme, T, pairs) {
  pairs.forEach(function (p) {
    const min = p[p.length - 1];
    const cols = p.slice(1, -1).map(k => (k[0] === '#' ? k : T[k]));
    if (cols.some(c => !c)) { assert(false, theme + ': ' + p[0] + ' — a token is missing'); return; }
    const r = ratio(cols);
    report.push(theme + '  ' + p[0] + ': ' + r.toFixed(2) + ':1');
    assert(r >= min, theme + ': ' + p[0] + ' reads at ' + r.toFixed(2) + ':1 (needs ' + min + ')');
  });
}
const LIGHT_ALL = Object.assign({}, DARK, LIGHT);
check('dark', DARK, PAIRS);
check('light', LIGHT_ALL, PAIRS.concat(LIGHT_ONLY));
if (process.env.THEME_RATIOS) console.log(report.join('\n'));
// The light page is light and its text dark — not an inversion of dark's hues.
assert(lum(parse(LIGHT['bg-primary'])) > 0.8 && lum(parse(LIGHT['bg-primary'])) < 1 && lum(parse(LIGHT['bg-card'])) === 1, 'light: a soft grey page with white cards');
assert(LIGHT['q-box-bg'] === '#e7f3f9' && LIGHT['q-box-border'] === '#b8dce9', 'light: Moodle\'s light-blue question box and its border');
assert(lum(parse(LIGHT['text-primary'])) < 0.03, 'light: dark navy text');

/* ---------- 3. Dark is the default; Light is applied before the first paint ---------- */
console.log('Light is this device\'s choice, applied before anything is drawn');
Object.keys(BUILDS).forEach(function (w) {
  const src = BUILDS[w];
  const head = src.slice(0, src.indexOf('</head>'));
  const s = head.indexOf('(function applySavedTheme()');
  assert(s !== -1 && s < head.indexOf('<style'), w + ': the saved theme is applied in <head>, before the first stylesheet');
  const code = head.slice(s, head.indexOf('})();', s) + 5);
  function run(stored, throws) {
    const attrs = {}, meta = { content: '#0c1117', setAttribute(k, v) { this[k] = v; } };
    const sb = {
      localStorage: { getItem(k) { if (throws) throw new Error('blocked'); return k === 'cestisTheme' ? stored : null; } },
      document: { documentElement: { setAttribute(k, v) { attrs[k] = v; } }, querySelector() { return meta; } }
    };
    vm.runInNewContext(code, sb);
    return { theme: attrs['data-theme'] || null, meta: meta.content };
  }
  assert(run(null).theme === null, w + ': nothing chosen → dark (no data-theme)');
  assert(run('dark').theme === null, w + ': Dark chosen → dark');
  const l = run('light');
  assert(l.theme === 'light' && l.meta === '#f6f8fa', w + ': Light chosen → light, and the phone\'s bar colour follows');
  assert(run('light', true).theme === null, w + ': storage blocked → dark, no error');
});

/* ---------- 4. The choice stays on this device ---------- */
console.log('One person\'s Light never travels to another device');
assert(Core.isSnapshotableKey('cestisTheme') === false, 'the backup snapshot never carries cestisTheme');
assert(Core.isSnapshotableKey('voctrain_exams') === true, '(while the Centre\'s records still go into it)');
const PC = read('cestis-page-cloud.js');
assert(/DEVICE_KEYS = \[[^\]]*'cestisTheme'/.test(PC), 'the Centre network\'s whole-store mirror skips it (DEVICE_KEYS)');
assert(/exclude: \[[^\]]*'cestisTheme'/.test(PC), 'and the dashboard\'s own sync excludes it');
['cestis-page-cloud.js', 'cestis-core.js'].forEach(function (f) {
  assert(read('Offline System/' + f) === read(f), 'Offline System/' + f + ' is the same file');
});

/* ---------- 5. The switches, and the time clock ---------- */
console.log('The switches are where people look, and the time clock keeps its own dark mode');
assert(/<button class="topbar-btn theme-toggle"[^>]*data-theme-toggle[^>]*onclick="cestisToggleTheme\(\)"[^>]*aria-label="Switch to light mode"/.test(INDEX),
  'the top bar has a sun/moon button with a name');
assert(INDEX.indexOf('<svg class="theme-ico-sun"') !== -1 && INDEX.indexOf('<svg class="theme-ico-moon"') !== -1, 'with a sun and a moon');
['editStu', 'editIns', 'editAcct'].forEach(function (p) {
  ['dark', 'light'].forEach(function (v) {
    assert(new RegExp('name="' + p + 'Theme" value="' + v + '" data-theme-choice[^>]*onchange="cestisSetTheme\\(this\\.value\\)"').test(INDEX),
      'Edit Profile (' + p + ') offers ' + v);
  });
});
const nav = extractFunction(INDEX, 'examNavPanelHtml');
assert(/data-theme-toggle/.test(nav) && /cestisToggleTheme\(\)/.test(nav) && /typeof cestisThemeIsLight === 'function'/.test(nav),
  'the exam navigation panel has its own switch (safe where the theme code is absent)');
const clockInits = INDEX.split("CESTISStore.getItem('cestisTimeDarkMode') === 'true' && !(typeof cestisThemeIsLight === 'function' && cestisThemeIsLight())").length - 1;
assert(clockInits === 2, 'both time-clock start-ups leave the clock light on a light dashboard (' + clockInits + ')');

const fns = ['cestisThemeIsLight', 'cestisSyncThemeControls', 'cestisSetTheme', 'cestisToggleTheme'].map(n => extractFunction(INDEX, n)).join('\n');
function world(storedClockDark) {
  const attrs = {}, ls = {}, calls = [];
  const btn = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const radios = [{ value: 'dark', checked: true }, { value: 'light', checked: false }];
  const meta = { content: '#0c1117', setAttribute(k, v) { this[k] = v; } };
  const els = { themeIcon: { textContent: '🌙' }, themeText: { textContent: 'Dark' }, ttApp: {} };
  const sb = {
    localStorage: { setItem(k, v) { ls[k] = String(v); }, getItem(k) { return ls[k] || null; } },
    CESTISStore: { getItem(k) { return k === 'cestisTimeDarkMode' ? storedClockDark : null; } },
    ttToggleDark(on) { calls.push(on); return on; },
    document: {
      documentElement: { setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; }, getAttribute(k) { return k in attrs ? attrs[k] : null; } },
      querySelector() { return meta; },
      querySelectorAll(sel) { return /data-theme-toggle/.test(sel) ? [btn] : /data-theme-choice/.test(sel) ? radios : []; },
      getElementById(id) { return els[id] || null; }
    }
  };
  vm.runInNewContext(fns, sb);
  return { sb, attrs, ls, calls, btn, radios, meta, els };
}
{
  const w = world('true');
  vm.runInNewContext('cestisSetTheme("light")', w.sb);
  assert(w.attrs['data-theme'] === 'light' && w.ls.cestisTheme === 'light', 'Light: the page turns light and this device remembers it');
  assert(w.calls[w.calls.length - 1] === false && w.els.themeIcon.textContent === '🌙', 'Light: the time clock shows light (its own dark switch untouched)');
  assert(w.btn.attrs['aria-label'] === 'Switch to dark mode' && w.radios[1].checked && !w.radios[0].checked, 'Light: the switches now offer Dark, and Edit Profile shows Light');
  assert(w.meta.content === '#f6f8fa', 'Light: the phone\'s bar colour follows');
  vm.runInNewContext('cestisToggleTheme()', w.sb);
  assert(!('data-theme' in w.attrs) && w.ls.cestisTheme === 'dark', 'the toggle goes back to dark');
  assert(w.calls[w.calls.length - 1] === true && w.els.themeIcon.textContent === '☀️', 'back on dark the clock returns to its own (dark) choice');
  assert(w.btn.attrs['aria-label'] === 'Switch to light mode' && w.radios[0].checked, 'and the switches offer Light again');
}
{
  const w = world(null);
  vm.runInNewContext('cestisSetTheme("light"); cestisSetTheme("dark")', w.sb);
  assert(w.calls.join() === 'false,false', 'a clock that was never dark stays light either way');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
