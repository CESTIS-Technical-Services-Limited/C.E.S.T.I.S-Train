/* At home, the idle lock accepts the trainee's correct password.
   Run: node tests/idle-lock-gate-unlock.test.js

   What used to go wrong: a trainee signed in from home through the trainee
   gate (a gate session) holds no password check on the device — by design,
   the gate keeps it. The idle lock's Unlock compared what she typed with that
   missing check, so her CORRECT password got "That password is not
   correct." and Sign Out was the only way out (dropping her out of a live
   class and re-fetching her whole record).

   Pinned here, on the dashboard's own idleLockUnlock and idleLockGateVerdict
   read from index.html: in a gate session the gate is asked (CESTISGate.signIn
   with her own username, exactly as at sign-in, so the gate's limit on wrong
   tries applies); a correct password unlocks (also when the account has a
   second step); a wrong one says so; "too many tries" is the gate's own
   words; a gate that cannot be reached is never reported as a wrong password.
   Off the gate, the lock checks the device's copy as before, and never asks
   the gate. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFunction(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
function extractVar(name) {
  const m = src.match(new RegExp('var ' + name + ' = \\{[\\s\\S]*?\\n\\};'));
  if (!m) throw new Error('index.html no longer defines ' + name);
  return m[0];
}

function lockScreen(opts) {
  const el = { idleLockPassword: { value: opts.typed }, idleLockError: { textContent: '', style: { display: 'none' } } };
  const sb = {
    console: console, String: String, Date: Date, Promise: Promise,
    document: { getElementById: id => el[id] || null },
    currentLoggedInUser: { id: 'USR-T1', name: 'Tameka Richards', username: 'tameka.richards', email: 'tameka@example.com' },
    userAccounts: opts.accounts || [],
    CESTISStore: { setItem: () => {}, namespace: opts.gate ? 'g1' : null },
    CESTISCore: { accountAccess: { hasPassword: a => !!(a && a.password) } },
    verifyPassword: async (p, h) => { sb.localChecks++; return p === 'Right-Pass-1' && h === 'pbkdf2$stored'; },
    cestisGateSession: () => !!opts.gate,
    closeModal: id => { if (id === 'idleLockModal') sb.closed++; },
    _sessionLocked: true, _sessionLastActivity: 0,
    closed: 0, localChecks: 0, asked: []
  };
  sb.window = sb;
  sb.CESTISGate = { signIn: async o => { sb.asked.push(o); return opts.gate(o); } };
  vm.createContext(sb);
  vm.runInContext(extractVar('GATE_SAY') + extractVar('GATE_SAY_CODE') + extractFunction('gateSay') + extractFunction('gateUnreachable') +
    extractFunction('idleLockGateVerdict') + 'var _idleLockChecking = false;\nasync ' + extractFunction('idleLockUnlock'), sb);
  return { sb, el, run: () => vm.runInContext('idleLockUnlock()', sb) };
}
// The gate, as CESTISGate.signIn answers.
const gateRight = o => o.password === 'Right-Pass-1' ? { ok: true, token: 'T', account: { id: 'USR-T1' } } : { ok: false, error: 'no-match' };

(async function () {
  console.log('At home (a gate session): the gate checks the password');
  {
    const t = lockScreen({ gate: gateRight, typed: 'Right-Pass-1' });
    await t.run();
    assert(t.sb.closed === 1 && t.sb._sessionLocked === false, 'her correct password unlocks the session');
    assert(t.sb.asked.length === 1 && t.sb.asked[0].login === 'tameka.richards' && t.sb.asked[0].password === 'Right-Pass-1', 'the gate is asked with her own username and what she typed');
    assert(t.sb.localChecks === 0, 'the device\'s (missing) password check is not used');
    assert(t.el.idleLockError.style.display === 'none', 'no message is left on screen');
  }
  {
    const t = lockScreen({ gate: gateRight, typed: 'Wrong-Pass-2' });
    await t.run();
    assert(t.sb.closed === 0 && t.sb._sessionLocked === true, 'a wrong password keeps the lock');
    assert(t.el.idleLockError.textContent === 'That password is not correct.', 'and says so: ' + t.el.idleLockError.textContent);
    assert(t.el.idleLockPassword.value === '', 'the box is cleared for another try');
  }
  {
    const t = lockScreen({ gate: () => ({ ok: true, need2fa: true, ticket: 'x', methods: ['totp'] }), typed: 'Right-Pass-1' });
    await t.run();
    assert(t.sb.closed === 1, 'an account with a second step: a correct password still unlocks (the lock never asks for the second step)');
  }
  {
    const t = lockScreen({ gate: () => ({ ok: false, error: 'locked', retryAfter: 900 }), typed: 'Right-Pass-1' });
    await t.run();
    assert(t.sb.closed === 0 && /^Too many tries/.test(t.el.idleLockError.textContent), 'the gate\'s limit on tries still applies, in its own words: ' + t.el.idleLockError.textContent);
  }
  for (const down of [{ ok: false, error: 'unreachable', unreachable: true }, { ok: false, error: 'busy', retry: true }, { ok: false, error: 'no-gate' }, null]) {
    const t = lockScreen({ gate: () => down, typed: 'Right-Pass-1' });
    await t.run();
    assert(t.sb.closed === 0 && t.el.idleLockError.textContent === 'Can\'t check your password right now — check your connection and try again.',
      'gate out of reach (' + JSON.stringify(down) + '): "Can\'t check your password right now…", never "not correct" — got: ' + t.el.idleLockError.textContent);
  }
  {
    const t = lockScreen({ gate: () => { throw new Error('offline'); }, typed: 'Right-Pass-1' });
    await t.run();
    assert(t.sb.closed === 0 && /^Can't check your password right now/.test(t.el.idleLockError.textContent), 'a request that throws is the same as out of reach');
  }

  console.log('On a Centre PC (no gate session): the device\'s copy, as before');
  {
    const acc = [{ id: 'USR-T1', password: 'pbkdf2$stored' }];
    const t = lockScreen({ gate: false, typed: 'Right-Pass-1', accounts: acc });
    t.sb.CESTISGate.signIn = async () => { throw new Error('the gate must not be asked'); };
    await t.run();
    assert(t.sb.closed === 1 && t.sb.localChecks === 1, 'the correct password unlocks, checked on the device');
    const w = lockScreen({ gate: false, typed: 'Wrong', accounts: acc });
    await w.run();
    assert(w.sb.closed === 0 && w.el.idleLockError.textContent === 'That password is not correct.', 'a wrong one is refused as before');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
