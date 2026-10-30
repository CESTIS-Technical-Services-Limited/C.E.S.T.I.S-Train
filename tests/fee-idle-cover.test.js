/* School Fee covers its records only after real idle time.

   What happened (office audit OF-8): the page was covered on EVERY visit —
   on entry, and again when the clerk came back from another page 1.5 seconds
   later — with "User inactive, please activate page when ready", and opened
   only after "Activate Window" and a 1.6-second animation: one click and
   about 4 seconds a visit, and a busy clerk told they were inactive.

   What this pins (School.Fee.html, both builds):
     - no cover on entry: the clerk who opened the page is using it;
     - the cover comes down after 5 minutes nobody used the page, as before
       (privacy is kept), and each mouse move, key or touch restarts that;
     - coming back from another page covers it only when the page has gone
       unused for the idle time meanwhile;
     - the cover says why it is there; it never calls the clerk "inactive".

   Run: node tests/fee-idle-cover.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

['School.Fee.html', 'Offline System/School.Fee.html'].forEach(function (file) {
  const SRC = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const fn = name => {
    const s = SRC.indexOf('function ' + name + '(');
    if (s < 0) throw new Error(file + ' no longer defines ' + name + '()');
    let d = 0;
    for (let i = SRC.indexOf('{', s); i < SRC.length; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}') { d--; if (!d) return SRC.slice(s, i + 1); } }
    throw new Error(name);
  };
  console.log('\n[' + file + '] No cover on entry; the cover after 5 minutes without use');
  const start = fn('feeStartPage');
  assert(start.indexOf('showInactivityScreen()') === -1, 'opening the page does not cover it');
  assert(/startSessionTimer\(\);/.test(start), 'the idle timer is started');
  assert(/const SESSION_TIMEOUT_MS = 5 \* 60 \* 1000;/.test(SRC), 'the idle time is 5 minutes');
  assert(/if \(d\.type === 'cestis-show-privacy'\) \{\s*if \(feeIdleForMs\(\) >= SESSION_TIMEOUT_MS\) showInactivityScreen\(\);/.test(SRC),
    'coming back from another page covers it only after the idle time');
  assert(SRC.indexOf('User inactive') === -1 || /told a clerk who was busy at the desk "User inactive"/.test(SRC), 'the cover never calls the clerk inactive');
  assert(/Hidden after 5 minutes without use, so nobody passing by can read the fee records\./.test(SRC), 'it says why it is there');
  assert(/id="activateWindowBtn"[^>]*>Show the page</.test(SRC), 'and how to carry on');

  // The timer itself, with a clock we move.
  let now = Date.parse('2026-10-30T14:00:00Z');
  const timers = [];
  const overlay = { classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } } };
  const sb = {
    Date: { now: () => now }, document: { getElementById: id => (id === 'inactivityOverlay' ? overlay : null), addEventListener() {}, removeEventListener() {} },
    setTimeout(f, ms) { timers.push({ f, at: now + ms }); return timers.length; }, clearTimeout(i) { if (timers[i - 1]) timers[i - 1].f = null; },
    startDvdBounce() {}, stopDvdBounce() {}
  };
  const tick = ms => { now += ms; timers.forEach(t => { if (t.f && t.at <= now) { const f = t.f; t.f = null; f(); } }); };
  vm.createContext(sb);
  vm.runInContext('const SESSION_TIMEOUT_MS = 5 * 60 * 1000; let inactivityIdleTimer = null; let inactivityScreenActive = false;\n' +
    SRC.slice(SRC.indexOf('let _feeLastActivityAt'), SRC.indexOf('function resetInactivityTimer')) + fn('resetInactivityTimer') + '\n' + fn('showInactivityScreen'), sb);
  vm.runInContext('_feeLastActivityAt = Date.now(); inactivityIdleTimer = setTimeout(showInactivityScreen, SESSION_TIMEOUT_MS);', sb);
  tick(4 * 60e3);
  vm.runInContext('resetInactivityTimer()', sb);   // the clerk moves the mouse
  tick(4 * 60e3);
  assert(!overlay.classList.contains('show'), '8 minutes of work, with a mouse move at 4: not covered');
  assert(vm.runInContext('feeIdleForMs()', sb) === 4 * 60e3, 'idle counts from the last use');
  tick(61e3);
  assert(overlay.classList.contains('show') && vm.runInContext('inactivityScreenActive', sb), '5 minutes without use: covered');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
