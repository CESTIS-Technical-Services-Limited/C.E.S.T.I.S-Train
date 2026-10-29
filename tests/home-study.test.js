/* Home study made smooth (the owner's group C, October 2026: "Make home study
   smooth"). Trainees sign in and study at home; these are the changes that
   make that smoother, pinned in Node. The same changes are walked through in
   real browsers by tests/browser/home-study.js.

     T7   the bell and the "current stage" stop glowing after a few pulses; only
          opacity moves; nothing moves for "reduce motion"

   Run: node tests/home-study.test.js */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.error('  ✗ FAIL: ' + m); } }
function eq(a, b, m) { assert(JSON.stringify(a) === JSON.stringify(b), m + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = (HTML.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join('\n');

/* ---------- T7. Animations that end ---------- */
console.log('\nT7. The bell and the current stage glow a few times, then stop');
function rule(sel) {
  const re = new RegExp('(^|\\n)\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = re.exec(css);
  return m ? m[2] : '';
}
function keyframes(name) {
  const i = css.indexOf('@keyframes ' + name);
  if (i === -1) return '';
  let depth = 0, j = css.indexOf('{', i);
  for (let k = j; k < css.length; k++) { if (css[k] === '{') depth++; if (css[k] === '}') { depth--; if (!depth) return css.slice(j, k + 1); } }
  return '';
}
['.topbar-btn.notif-active', '.topbar-btn.notif-active::after', '.stage-circle.current', '.stage-circle.current::after'].forEach(sel => {
  const r = rule(sel);
  assert(r, sel + ' is styled');
  assert(!/infinite/.test(r), sel + ' does not animate for ever (' + r.replace(/\s+/g, ' ').slice(0, 120) + ')');
});
assert(/animation:\s*bellGlow\s+2s\s+ease-in-out\s+3\b/.test(rule('.topbar-btn.notif-active::after')), 'the bell glows three times');
assert(/animation:\s*pulseGlow\s+2s\s+ease-in-out\s+3\b/.test(rule('.stage-circle.current::after')), 'the current stage pulses three times');
['bellGlow', 'pulseGlow'].forEach(n => {
  const k = keyframes(n);
  assert(k && /opacity/.test(k), '@keyframes ' + n + ' moves opacity');
  assert(!/box-shadow|width|height|top|left|margin|padding/.test(k), '@keyframes ' + n + ' moves nothing that repaints or lays out (' + k.replace(/\s+/g, ' ') + ')');
});
const rm = (css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g) || []).join('\n');
assert(/\.topbar-btn\.notif-active::after/.test(rm) && /\.stage-circle\.current::after/.test(rm), '"reduce motion": neither moves at all');
assert(/btn\.setAttribute\('data-unread'/.test(HTML) && /unread > prev/.test(HTML), 'a NEW notice glows again (three times); the same count stays still');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
