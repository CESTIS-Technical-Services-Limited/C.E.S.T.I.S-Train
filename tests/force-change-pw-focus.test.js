/* "Set a new password": the cursor is never pulled back from "Confirm password".

   What happened (after the dialog watcher of the UI improvements): the
   watcher puts the cursor in "New password" the moment the dialog opens, and
   the dialog's own older 60 ms nudge then focused "New password" again. When
   somebody had already moved on to "Confirm password" — the training-day
   browser walk-through fills both at once — the confirmation was typed into
   the first field, the dialog said "Passwords do not match", and the
   administrator of a brand-new Centre could not get in (tests/browser/
   lms-flows.js step 1 failed on the integration branch).

   Pinned: openForceChangePw's nudge leaves the cursor where it is when it is
   already inside the dialog, and still puts it in "New password" when it is
   not (a browser where the watcher did not run). Both builds.

   Run: node tests/force-change-pw-focus.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

function extractFunction(src, name) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

['index.html', 'Offline System/index.html'].forEach(function (file) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  console.log('\n[' + file + '] The "set a new password" dialog never pulls the cursor back');
  function run(cursorInDialog) {
    const timers = [], focused = [];
    const el = (id) => ({ id, value: 'x', style: {}, focus() { focused.push(id); sb.document.activeElement = this; } });
    const n = el('forceChangePwNew'), c = el('forceChangePwConfirm'), e = el('forceChangePwError');
    const outside = el('adminPass');
    const modal = { id: 'forceChangePwModal', contains: x => x === n || x === c };
    const byId = { forceChangePwNew: n, forceChangePwConfirm: c, forceChangePwError: e, forceChangePwModal: modal };
    const sb = { document: { getElementById: id => byId[id] || null, activeElement: outside },
      setTimeout: fn => { timers.push(fn); return timers.length; },
      openModal() { if (cursorInDialog) sb.document.activeElement = n; } };
    vm.createContext(sb);
    vm.runInContext('var _forceChangePwRole = null, _forceChangePwThen = null;\n' + extractFunction(src, 'openForceChangePw'), sb);
    vm.runInContext("openForceChangePw('admin', null)", sb);
    assert(n.value === '' && c.value === '', 'opening the dialog empties both fields');
    // The person (or the walk-through) moves on to "Confirm password" before the nudge.
    if (cursorInDialog) c.focus();
    focused.length = 0;
    timers.forEach(fn => fn());
    return { active: sb.document.activeElement && sb.document.activeElement.id, focused };
  }
  let r = run(true);
  assert(r.active === 'forceChangePwConfirm' && r.focused.length === 0, 'with the cursor already in "Confirm password", the nudge leaves it there — got ' + JSON.stringify(r));
  r = run(false);
  assert(r.active === 'forceChangePwNew', 'with the cursor outside the dialog, the nudge still puts it in "New password" — got ' + JSON.stringify(r));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
