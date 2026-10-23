/* Signing in at the gate: the password challenge, sessions and their
   revocation, two-step codes, and the canonical text every seal is made of.

   The gate never sees a password and never runs PBKDF2 (DESIGN.md §4.1):
   the device works out the stored hash itself — PBKDF2 with the stored
   salt, or the legacy SHA-256 — and answers HMAC(hash, nonce|login); the
   gatekeeper does one HMAC with the hash the accounts list already holds.
   A session is a signed token carrying the account's credential version
   (cv): a password reset, a switch-off or a two-step change gives a new cv,
   and every older token stops working. Two-step codes are RFC 6238.

   Pinned here, against independent implementations (Node's crypto, the
   dashboard's own hashPassword() read out of index.html and run on Node's
   WebCrypto, the vendored OTPAuth library the dashboard checks codes with,
   and MegaData.canon):
     - the proof for every stored format (PBKDF2, legacy SHA-256), refused
       for a wrong password, nonce or login, and never for a plaintext or
       empty stored password; an unknown login is given a believable salt;
     - token sign/verify, expiry, tampering, the refresh hint, and cv
       revocation (password, status, switch-off, two-step, deletion);
     - session ids, session keys and sealed items;
     - RFC 4226 / RFC 6238 test vectors and parity with OTPAuth, the ±1 step
       window, a code refused the second time in its step;
     - Core.gate.canon gives MegaData.canon's output, byte for byte;
     - selfTest passes on a correct runtime and names what a broken one
       computes wrongly.

   Run: node tests/gate-auth.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');
const Core = require('../cestis-core.js');
const MegaData = require('../megadata/schemas.js');
const OTPAuth = require('../vendor/otpauth-9.2.2.umd.min.js');
const { crypto } = require('./gate-fixture.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const G = Core.gate;
const hmac = (key, msg) => nodeCrypto.createHmac('sha256', key).update(msg, 'utf8').digest('hex');
const sha256 = s => nodeCrypto.createHash('sha256').update(s, 'utf8').digest('hex');
// What a trainee's device sends: worked out with Node alone, never with Core.gate.
function deviceProof(password, challenge, nonce, login) {
  const V = challenge.algo === 'pbkdf2-sha256'
    ? nodeCrypto.pbkdf2Sync(password, Buffer.from(challenge.salt, 'hex'), challenge.iter, 32, 'sha256').toString('hex')
    : sha256(password + '__CESTIS_SALT_2026__');
  return hmac(V, 'cestis-gate-v1|' + nonce + '|' + String(login).trim().toLowerCase());
}

(async () => {
  /* ------------------------------------------------------------ proof */
  console.log('The password challenge: one HMAC at the gate, the password never sent');
  {
    // A password hashed by the dashboard's own code (index.html), on WebCrypto.
    const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const grab = name => {
      const m = new RegExp('(async )?function ' + name + '\\(').exec(INDEX);
      let depth = 0;
      for (let i = INDEX.indexOf('{', m.index); i < INDEX.length; i++) {
        if (INDEX[i] === '{') depth++; else if (INDEX[i] === '}') { depth--; if (!depth) return INDEX.slice(m.index, i + 1); }
      }
    };
    const ctx = { crypto: globalThis.crypto, TextEncoder, Uint8Array, console };
    vm.createContext(ctx);
    vm.runInContext(/var PBKDF2_ITERATIONS = \d+;/.exec(INDEX)[0] + ['_bufToHex', '_hexToBuf', 'hashPasswordLegacy', '_pbkdf2Hex', 'hashPassword', 'verifyPassword'].map(grab).join('\n'), ctx);
    const stored = await ctx.hashPassword('Correct Horse 7');
    assert(/^pbkdf2\$210000\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(stored), 'the dashboard stores pbkdf2$210000$salt$hash');
    const ch = G.proof.challenge(stored, 'Kemar01', 'GATE-SECRET', crypto);
    assertEq([ch.algo, ch.iter, ch.salt], ['pbkdf2-sha256', 210000, stored.split('$')[2]], 'the device is told the algorithm, iterations and salt');
    const good = deviceProof('Correct Horse 7', ch, 'N-1', 'Kemar01');
    assert(G.proof.verify(stored, 'N-1', 'Kemar01', good, crypto), 'the right password\'s proof is accepted');
    assert(G.proof.verify(stored, 'N-1', '  KEMAR01 ', good, crypto), 'whatever the login\'s case and spacing');
    assert(G.proof.verify(stored, 'N-1', 'kemar01', good.toUpperCase(), crypto), 'and in either case of hex');
    assert(!G.proof.verify(stored, 'N-1', 'Kemar01', deviceProof('Correct Horse 8', ch, 'N-1', 'Kemar01'), crypto), 'a wrong password\'s is refused');
    assert(!G.proof.verify(stored, 'N-2', 'Kemar01', good, crypto), 'a proof made for another nonce is refused (no replay)');
    assert(!G.proof.verify(stored, 'N-1', 'Rushane02', good, crypto), 'and for another login');
    assert(!G.proof.verify(stored, 'N-1', 'Kemar01', '', crypto) && !G.proof.verify(stored, 'N-1', 'Kemar01', null, crypto), 'an empty proof is refused');
    assertEq(G.proof.expected(stored, 'N-1', 'Kemar01', crypto), good, 'expected() is exactly what the device computes');
    // A stored hash of other iterations (an older or a test account) works the same.
    const fast = 'pbkdf2$1000$00aa11bb$' + nodeCrypto.pbkdf2Sync('pw', Buffer.from('00aa11bb', 'hex'), 1000, 32, 'sha256').toString('hex');
    const ch2 = G.proof.challenge(fast, 'x', 'S', crypto);
    assert(ch2.iter === 1000 && G.proof.verify(fast, 'n', 'x', deviceProof('pw', ch2, 'n', 'x'), crypto), 'any stored iteration count is honoured');
    // Legacy SHA-256.
    const legacy = await ctx.hashPasswordLegacy('old-password');
    const ch3 = G.proof.challenge(legacy, 'tameka', 'S', crypto);
    assertEq([ch3.algo, ch3.salt], ['sha256-legacy', ''], 'a legacy hash: SHA-256 with the app\'s fixed salt');
    assert(G.proof.verify(legacy, 'n9', 'tameka', deviceProof('old-password', ch3, 'n9', 'tameka'), crypto), 'its proof is accepted');
    assert(!G.proof.verify(legacy, 'n9', 'tameka', deviceProof('Old-password', ch3, 'n9', 'tameka'), crypto), 'a wrong one refused');
    // Never a plaintext or empty password, never a malformed hash.
    ['plaintext-secret', '', null, 'pbkdf2$x$y', 'pbkdf2$1000$zz$aa', 'ABCDEF'.repeat(10) + 'ABCD'].forEach(s => {
      assert(G.proof.expected(s, 'n', 'l', crypto) === null && !G.proof.verify(s, 'n', 'l', hmac(String(s), 'cestis-gate-v1|n|l'), crypto),
        'a stored ' + JSON.stringify(s) + ' never signs anybody in at the gate');
    });
    // An unknown login looks like any other.
    const u1 = G.proof.challenge(null, 'nobody@x', 'GATE-SECRET', crypto), u2 = G.proof.challenge(null, 'NOBODY@X ', 'GATE-SECRET', crypto);
    const u3 = G.proof.challenge(null, 'other@x', 'GATE-SECRET', crypto);
    assert(u1.algo === 'pbkdf2-sha256' && u1.iter === 210000 && /^[0-9a-f]{32}$/.test(u1.salt), 'an unknown login is given a believable challenge');
    assert(u1.salt === u2.salt && u1.salt !== u3.salt, 'the same each time it is asked, different for each login');
    assertEq(u1.salt, hmac('GATE-SECRET', 'fake|nobody@x').slice(0, 32), 'derived from the gate\'s secret');
  }

  /* ------------------------------------------------------------ tokens */
  console.log('Sessions: signed, they expire, and an account change revokes them');
  {
    const SECRET = 'a'.repeat(64);
    const acct = { id: 'USR-T01', password: 'pbkdf2$1000$aa$bb', status: 'active' };
    const cv = G.cv(acct, crypto);
    assertEq(cv, sha256('pbkdf2$1000$aa$bb|active||').slice(0, 12), 'cv: the first 12 hex of sha256(password|status|disabledAt|twoFactorUpdatedAt)');
    const T0 = Date.parse('2026-11-02T12:00:00Z');
    const tok = G.token.sign({ a: 'USR-T01', s: 'STU-1', sid: 'sid-1', iat: T0, cv }, SECRET, crypto);
    const parts = tok.split('.');
    assertEq(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')), { a: 'USR-T01', cv, exp: T0 + 12 * 3600000, iat: T0, s: 'STU-1', sid: 'sid-1' },
      'v1.<base64url claims>.<mac>, valid 12 hours by default');
    assertEq(parts[2], hmac(SECRET, 'tok|' + parts[1]), 'the mac is HMAC-SHA256(secret, "tok|" + claims)');
    const live = { nowMs: T0 + 3600000, cvOf: () => cv };
    const v = G.token.verify(tok, SECRET, crypto, live);
    assert(v.ok && v.claims.a === 'USR-T01' && v.refresh === false, 'it verifies');
    assertEq(G.token.verify(tok, SECRET, crypto, { nowMs: T0 + 9 * 3600000 }).refresh, true, 'with under 4 hours left it asks to be renewed');
    assertEq(G.token.verify(tok, SECRET, crypto, { nowMs: T0 + 12 * 3600000 }).reason, 'expired', 'at 12 hours it has expired');
    assertEq(G.token.verify(tok, 'b'.repeat(64), crypto, live).reason, 'bad-signature', 'another secret did not sign it');
    const forged = 'v1.' + Buffer.from(JSON.stringify({ a: 'USR-T02', cv, exp: T0 + 9e9, iat: T0, s: 'STU-2', sid: 'x' })).toString('base64url') + '.' + parts[2];
    assertEq(G.token.verify(forged, SECRET, crypto, live).reason, 'bad-signature', 'changed claims are refused');
    assertEq(G.token.verify(parts[0] + '.' + parts[1] + '.' + parts[2].replace(/.$/, c => c === '0' ? '1' : '0'), SECRET, crypto, live).reason, 'bad-signature',
      'a changed mac is refused');
    ['', 'v1.x', 'v2.' + parts[1] + '.' + parts[2], 'v1..' + parts[2], null, 'v1.' + parts[1] + '.zz'].forEach(t => {
      assertEq(G.token.verify(t, SECRET, crypto, live).reason, 'malformed', JSON.stringify(t) + ' is not a token');
    });
    // Revocation.
    const changed = [
      ['a password reset', Object.assign({}, acct, { password: 'pbkdf2$1000$cc$dd' })],
      ['a switch-off', Object.assign({}, acct, { status: 'disabled' })],
      ['a switch-off with its date', Object.assign({}, acct, { disabledAt: '2026-11-02T13:00:00Z' })],
      ['a two-step change', Object.assign({}, acct, { twoFactorUpdatedAt: '2026-11-02T13:00:00Z' })]
    ];
    changed.forEach(([what, a2]) => {
      assertEq(G.token.verify(tok, SECRET, crypto, { nowMs: T0 + 1000, cvOf: () => G.cv(a2, crypto) }).reason, 'revoked', what + ' revokes every session');
    });
    assertEq(G.token.verify(tok, SECRET, crypto, { nowMs: T0 + 1000, cvOf: () => G.cv(Object.assign({}, acct, { name: 'Renamed' }), crypto) }).ok, true,
      'an edit that is not a credential (a name) does not');
    assertEq(G.token.verify(tok, SECRET, crypto, { nowMs: T0 + 1000, cvOf: () => null }).reason, 'unknown-account', 'a deleted account\'s sessions end');

    // Session ids and keys, sealed items.
    const sid = G.sid.make(T0, 'Rand0m-Bytes!', SECRET, crypto);
    assert(/^[0-9a-z]+\.Rand0mBytes\.[0-9a-f]{8}$/.test(sid), 'a session id: <issued, base 36>.<random>.<8-hex seal>');
    assertEq(G.sid.check(sid, SECRET, crypto), { ok: true, iat: T0 }, 'its age is read from it, no table needed');
    assertEq(G.sid.check(sid.replace(/\.[0-9a-f]{8}$/, '.00000000'), SECRET, crypto).reason, 'bad-signature', 'a made-up one is refused');
    assertEq(G.sid.check(sid.replace(/^[0-9a-z]+/, (T0 - 1e9).toString(36)), SECRET, crypto).reason, 'bad-signature', 'an older date cannot be written into one');
    const sk = G.sessionKey(SECRET, 'USR-T01', sid, crypto);
    assertEq(sk, hmac(SECRET, 'sk|USR-T01|' + sid), 'the session key: HMAC(secret, "sk|" + account + "|" + session)');
    const it = { id: 'IT-1', a: 'USR-T01', sid, kind: 'rec', key: 'voctrain_submissions', rec: { id: 'S1', note: 'café ✓' }, createdAt: '2026-11-02T12:00:00Z' };
    const sealed = G.seal(it, sk, crypto);
    assertEq(sealed.mac, hmac(sk, MegaData.canon(it)), 'an item is sealed with HMAC(session key, canon(item without its seal))');
    assert(G.sealOk(sealed, sk, crypto), 'and checks');
    assert(!G.sealOk(Object.assign({}, sealed, { a: 'USR-T02' }), sk, crypto), 'a changed field breaks the seal');
    assert(!G.sealOk(JSON.parse(JSON.stringify(sealed).replace('café', 'cafe')), sk, crypto), 'however small');
    assert(!G.sealOk(sealed, G.sessionKey(SECRET, 'USR-T01', 'other', crypto), crypto), 'another session\'s key does not open it');
    assert(!G.sealOk(it, sk, crypto), 'an unsealed item is refused');
  }

  /* -------------------------------------------------------------- TOTP */
  console.log('Two-step codes: RFC 4226 and RFC 6238 vectors, and the dashboard\'s own library');
  {
    const key = Array.from(Buffer.from('12345678901234567890'));
    assertEq([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(c => G.totp.hotp(key, c, 6, crypto)),
      ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'], 'RFC 4226 HOTP vectors');
    const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
    vectors.forEach(([t, code]) => assertEq(G.totp.code(key, t * 1000, crypto, { digits: 8 }), code, 'RFC 6238 SHA-1 at T=' + t));
    assertEq(G.totp.base32('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), key, 'base32 decodes the RFC key');
    assertEq(G.totp.base32('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'), key, 'in lower case and with spaces');
    assertEq([G.totp.base32('GEZ1'), G.totp.base32('')], [null, null], 'and refuses what is not base32');
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    let agree = 0;
    for (let i = 0; i < 40; i++) {
      const t = 1700000000000 + i * 977531;
      const lib = new OTPAuth.TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret }).generate({ timestamp: t });
      if (G.totp.code(secret, t, crypto) === lib) agree++;
    }
    assertEq(agree, 40, 'every code matches OTPAuth, which the dashboard checks codes with');
    const now = 1700000015000, code = G.totp.code(secret, now, crypto);
    const step = Math.floor(now / 30000);
    assertEq(G.totp.verify(secret, code, now, crypto), { ok: true, step }, 'the current code is accepted, with its step');
    assert(G.totp.verify(secret, code, now + 30000, crypto).ok && G.totp.verify(secret, code, now - 30000, crypto).ok, 'one step either side');
    assert(!G.totp.verify(secret, code, now + 61000, crypto).ok && !G.totp.verify(secret, code, now - 61000, crypto).ok, 'not two');
    const used = {};
    const once = s => { if (used[s]) return true; used[s] = 1; return false; };
    assert(G.totp.verify(secret, code, now, crypto, { used: once }).ok, 'a code is accepted once');
    assertEq(G.totp.verify(secret, code, now, crypto, { used: once }), { ok: false, reason: 'used', step }, 'and refused the second time in its step');
    assert(!G.totp.verify(secret, '12345', now, crypto).ok && !G.totp.verify(secret, 'abcdef', now, crypto).ok && !G.totp.verify('', code, now, crypto).ok,
      'a short code, letters, or no secret: refused');
    assert(G.totp.verify(secret, code.slice(0, 3) + ' ' + code.slice(3), now, crypto).ok, 'a code typed with a space is fine');
    assertEq(G.codeHash(' abcd 1234 '.trim().toLowerCase()), G.codeHash('ABCD 1234'), 'a backup code is named the same whatever its case');
  }

  /* ------------------------------------------------------------- canon */
  console.log('Canonical text: Core.gate.canon is MegaData.canon');
  {
    let seed = 99;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const strings = ['', 'a', 'Ünïcödé ✓', 'line\nbreak', '"quoted"', ' ', '😀', 'z'.repeat(40), '__proto__x', 'constructor'];
    const gen = depth => {
      const r = rnd();
      if (depth > 3 || r < 0.3) return [null, true, false, 0, -0, 1.5, -42, 1e21, 123456789, strings[Math.floor(rnd() * strings.length)]][Math.floor(rnd() * 10)];
      if (r < 0.6) { const a = []; for (let i = 0; i < Math.floor(rnd() * 4); i++) a.push(gen(depth + 1)); return a; }
      const o = {};
      for (let i = 0; i < Math.floor(rnd() * 5); i++) o[strings[Math.floor(rnd() * strings.length)] + i] = gen(depth + 1);
      if (rnd() < 0.2) o.skipped = undefined;
      return o;
    };
    let same = 0;
    for (let i = 0; i < 400; i++) { const v = gen(0); if (G.canon(v) === MegaData.canon(v)) same++; }
    assertEq(same, 400, '400 random values give the same text');
    assertEq(G.canon({ b: 1, a: [true, null, 'x'], c: { z: 0, y: -0 } }), '{"a":[true,null,"x"],"b":1,"c":{"y":0,"z":0}}', 'sorted keys, -0 as 0');
    [NaN, Infinity, () => 1].forEach(bad => {
      let a = null, b = null;
      try { G.canon({ x: bad }); } catch (e) { a = 'threw'; }
      try { MegaData.canon({ x: bad }); } catch (e) { b = 'threw'; }
      assertEq([a, b], ['threw', 'threw'], 'both refuse ' + String(bad));
    });
    ['', 'ascii', 'Ünïcödé ✓', '😀 emoji', 'lone \ud800 surrogate'].forEach(s => {
      assertEq(G.utf8(s), Array.from(Buffer.from(s, 'utf8')), 'UTF-8 of ' + JSON.stringify(s) + ' is the platform\'s');
      assertEq(G.b64url(G.utf8(s)), Buffer.from(s, 'utf8').toString('base64url'), 'and its base64url too');
      assertEq(G.unb64url(G.b64url(G.utf8(s))), G.utf8(s), 'which reads back');
    });
  }

  /* ---------------------------------------------------------- self-test */
  console.log('The self-test passes on a right runtime and says what a wrong one gets wrong');
  {
    const ok = G.selfTest(crypto);
    assert(ok.ok && ok.checks.length >= 6 && ok.checks.every(c => c.ok), 'every known answer is computed right with Node\'s crypto');
    const brokenHmac = Object.assign({}, crypto, { hmacHex: (k, m) => crypto.hmacHex(k, m + ' ') });
    const bad = G.selfTest(brokenHmac);
    assertEq([bad.ok, bad.checks.filter(c => !c.ok).map(c => c.name)], [false, ['hmac-sha256', 'token']], 'a wrong HMAC is named');
    const brokenSha1 = Object.assign({}, crypto, { sha1Bytes: b => crypto.sha1Bytes(b.concat([0])) });
    assertEq(G.selfTest(brokenSha1).checks.filter(c => !c.ok).map(c => c.name), ['totp'], 'a wrong SHA-1 is named');
    assertEq(G.selfTest({}).ok, false, 'no cryptography at all: not fit to run');
    let threw = null;
    try { G.token.sign({ a: 'x', iat: 1 }, 's', {}); } catch (e) { threw = e.message; }
    assert(/crypto\.hmacHex is required/.test(threw || ''), 'and a call without it says what is missing');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
