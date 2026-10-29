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

/* ---------- T14. Small phone friction ---------- */
console.log('\nT14. The trainees\' link opens on her form; 44 px targets; real labels; honest words');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
assert(/if \(CESTISGate\.takeLink\(\)\) _gateT\.fromLink = true;/.test(HTML), 'the page notes that it was opened from the trainees\' link');
assert(/function homeTraineeFirst\(\)/.test(HTML) && /homeTraineeFirst\(\);\n\}/.test(HTML), 'the trainee card, once set up for the gate, opens her form first');
assert(/document\.body\.classList\.contains\('gate-trainee-only'\)/.test(HTML.slice(HTML.indexOf('function homeTraineeFirst'), HTML.indexOf('function homeShowStaffCards'))),
  'on a trainee\'s own device too — never on a PC that holds the Centre\'s records');
assert(/body\.trainee-first \.role-cards \.role-card:not\(#studentCard\) \{ display:none; \}/.test(css), 'the staff cards are out of her way');
assert(/class="register-link staff-cards-toggle" onclick="homeShowStaffCards\(\)">Staff sign-in</.test(HTML), '… one tap away ("Staff sign-in")');
assert(/body\.trainee-first #studentCard \.role-enter-btn \{ order:1;/.test(css), 'Sign in sits right under the password');
const tap = (css.match(/@media \(pointer: coarse\), \(max-width: 600px\) \{[\s\S]*?\n\}/) || [''])[0];
['[id^="page-s-"] .btn-sm', '[id^="page-s-"] a.cw-file-link', '.landing-footer a'].forEach(sel => {
  assert(tap.indexOf(sel) !== -1 && /min-height:44px/.test(tap), sel + ' is at least 44 px tall on a phone');
});
assert((HTML.match(/class="cw-file-link /g) || []).length === 2, 'every link to a coursework file carries cw-file-link');
assert(/<label for="s-vc-join-code"[^>]*>[\s\S]*?Room code/.test(read('Video-Conference-Student.html')), 'the room-code box has a real label');
assert(/<label for="sResSearch"[^>]*>Search resources<\/label>/.test(read('Pages/Student-Resources.html')), 'the resources search box has a real label');
assert(/<label class="home-sr-only" for="__PREFIX__ChatSearch">Search chats<\/label>\s*<input type="text" id="__PREFIX__ChatSearch"/.test(read('LMS-Chat-Member.html')), 'the chat search box has a real label');
const tg = read('Transcript-Grades.html');
assert(tg.indexOf('the moment an exam is marked') === -1, 'the transcript no longer says grades appear "the moment an exam is marked"');
assert(/Your grades appear here once a test is marked or the office updates your record\. A new mark usually takes a few minutes to reach you\./.test(tg), '… it says what really happens');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
