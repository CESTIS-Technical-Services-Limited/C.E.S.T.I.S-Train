/* "Turn on" waits for the trainee side of the gate.

   Stage 3 lets an administrator set the gate up and press Check, but trainees
   can only sign in through it once the trainee side (Stage 4, window.CESTISGate)
   is part of the site. Until then Turn on must refuse, so nobody prints a
   sign-in code that leads trainees nowhere. Turning it OFF must always work.

   Run: node tests/gate-card-ready.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.error('  ✗ FAIL: ' + m); } }
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(start, i + 1); } }
  throw new Error(name + ' not closed');
}

['', 'Offline System'].forEach(where => {
  const w = (where ? where + '/' : '') + 'index.html';
  const src = fs.readFileSync(path.join(__dirname, '..', where, 'index.html'), 'utf8');
  function page(withClient, enabled) {
    const sb = { toasts: [], saved: 0, offFile: [] };
    sb.window = withClient ? { CESTISGate: { signIn: function () {} } } : {};
    sb.systemSettings = { traineeGate: { url: 'https://example.invalid/exec', enabled: !!enabled } };
    sb.currentLoggedInUser = { username: 'mthompson' };
    sb.showToast = (m, t) => sb.toasts.push(m);
    sb.saveState = () => { sb.saved++; };
    sb.gateAdminOnly = () => true;
    sb.gateDevRead = () => null;
    sb.gatePublishedState = () => ({ health: { url: 'https://example.invalid/exec', ok: true } });
    sb.gateCardRefresh = () => {};
    sb.gateApplyOffFile = off => sb.offFile.push(off);
    sb._gateRun = {};
    vm.createContext(sb);
    vm.runInContext(extractFunction(src, 'gateTraineeSignInReady') + '\n' + extractFunction(src, 'gateToggle'), sb);
    return sb;
  }
  console.log(w + ': without the trainee side, Turn on refuses and changes nothing');
  let p = page(false, false);
  vm.runInContext('gateToggle()', p);
  assert(p.systemSettings.traineeGate.enabled === false && p.saved === 0 && p.offFile.length === 0, w + ': nothing switched on, nothing saved');
  assert(/after the next update/.test(p.toasts.join(' ')), w + ': the administrator is told why — got ' + JSON.stringify(p.toasts));
  console.log(w + ': Turn off always works');
  p = page(false, true);
  vm.runInContext('gateToggle()', p);
  assert(p.systemSettings.traineeGate.enabled === false && p.saved === 1 && p.offFile[0] === true, w + ': switched off, saved, gate-off written');
  console.log(w + ': with the trainee side present, Turn on works as before');
  p = page(true, false);
  vm.runInContext('gateToggle()', p);
  assert(p.systemSettings.traineeGate.enabled === true && p.saved === 1 && p.offFile[0] === false, w + ': switched on after a good Check');
  const card = fs.readFileSync(path.join(__dirname, '..', where, 'Pages', 'Administration.html'), 'utf8');
  assert(/id="gateNotReadyNote"/.test(card), w + ': the card says why Turn on is not available yet');
  assert(/btn\.disabled = !on && \(!tg\.url \|\| !ready\)/.test(extractFunction(src, 'gateCardRefresh')), w + ': the button stays disabled until the trainee side is there');
});
// The card's "A newer version is available" line depends on this number matching the gate.
(function () {
  const root = path.join(__dirname, '..');
  const gs = fs.readFileSync(path.join(root, 'trainee-gate', 'Gate.gs'), 'utf8').match(/var GATE_VERSION = (\d+);/);
  const paste = fs.readFileSync(path.join(root, 'trainee-gate', 'PASTE-GATE.gs'), 'utf8').match(/var GATE_VERSION = (\d+);/);
  assert(gs && paste && gs[1] === paste[1], 'PASTE-GATE.gs carries the same GATE_VERSION as Gate.gs');
  ['', 'Offline System'].forEach(where => {
    const src = fs.readFileSync(path.join(root, where, 'index.html'), 'utf8').match(/var GATE_EXPECTED_VERSION = (\d+);/);
    assert(gs && src && src[1] === gs[1], (where || '.') + '/index.html expects gate version ' + (src && src[1]) + ', Gate.gs is version ' + (gs && gs[1]));
  });
  const setup = fs.readFileSync(path.join(root, 'trainee-gate', 'SETUP.md'), 'utf8');
  assert(gs && setup.indexOf('version: ' + gs[1] + ', …}') !== -1 && setup.indexOf('Ready — version ' + gs[1]) !== -1, 'SETUP.md tells the administrator to expect version ' + (gs && gs[1]));
})();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
