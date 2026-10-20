/* Signed certificates: an employer verifies with no sign-in (certs-09).

   What went wrong: the QR code on a certificate opened the portal, and on an
   employer's phone the portal had no records — "Sync Required" — and Sync
   Now asked for the Centre's own Google login, with full-Drive access. The
   QR code could not be verified by the people it was printed for.

   What is pinned here: the QR code of a signed certificate carries what the
   certificate states and an ECDSA P-256 signature over it; the verify door
   checks it in the browser against the public keys in cert-keys.json. A
   changed letter in any field fails, a withdrawn certificate the Centre has
   published shows as revoked, an unknown key falls back to the records (the
   behaviour every unsigned certificate keeps), and the committed key file
   never carries a private key. The browser proof is
   tests/browser/cert-verify.js.

   Run: node tests/cert-signing.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const PAGES = [
  { where: 'index.html', src: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), core: require('../cestis-core.js') },
  { where: 'Offline System/index.html', src: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8'), core: require('../Offline System/cestis-core.js') }
];
function extractFunction(src, name, where) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error(where + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

(async function main() {
  console.log('The committed key file holds public keys only');
  const keysFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'cert-keys.json'), 'utf8'));
  assert(Array.isArray(keysFile.keys) && Array.isArray(keysFile.revoked), 'cert-keys.json has a keys list and a revoked list');
  assert(keysFile.keys.every(k => k && k.publicJwk && !('d' in k.publicJwk) && !k.privateJwk), 'no entry in cert-keys.json carries a private key');
  assert(!/"d"\s*:/.test(fs.readFileSync(path.join(ROOT, 'cert-keys.json'), 'utf8')), 'not even a stray "d" value');
  assert(/signing-key-PRIVATE/.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')), 'a downloaded private-key backup is ignored by git');
  assert(fs.existsSync(path.join(ROOT, 'Offline System', 'cert-keys.json')), 'the Offline System ships the key file too');

  for (const page of PAGES) {
    const w = page.where, S = page.core.certs.sig;
    console.log(w + ': sign, verify, tamper');
    const key = await S.generateKey('test');
    assert(/^[A-Za-z0-9_-]{12}$/.test(key.kid) && key.privateJwk.d && !key.publicJwk.d, w + ': a key has a short id, and its public half has no private part');
    const other = await S.generateKey('other');
    const pub = { keys: [{ kid: key.kid, alg: 'ES256', publicJwk: key.publicJwk }], revoked: [] };
    const student = { certNo: 'WE-2026-4821-KX', name: 'Shanté  O’Neil', course: '02. Welding & Fabrication', certDate: 'October 16, 2026' };
    const f = S.fields(student, 'Welding & Fabrication Level 2');
    assertEq(f.name, 'Shanté O’Neil', w + ': whitespace is normalised before signing');
    const rec = await S.sign(key, f, '2026-10-20T10:00:00.000Z');
    assert(rec.kid === key.kid && /^[A-Za-z0-9_-]{86}$/.test(rec.sig), w + ': a 64-byte signature, base64url');
    assertEq((await S.verify(rec, pub)).result, 'valid', w + ': the signature verifies against the published key');
    for (const [field, value] of [['no', 'WE-2026-4821-KY'], ['name', 'Shante O’Neil'], ['programme', 'Welding & Fabrication Level 3'], ['date', 'October 17, 2026']]) {
      assertEq((await S.verify(Object.assign({}, rec, { [field]: value }), pub)).result, 'altered', w + ': changing the ' + field + ' breaks it');
    }
    const forged = await S.sign(Object.assign({}, other, { kid: key.kid }), f);
    assertEq((await S.verify(forged, pub)).result, 'altered', w + ': a signature made with another key under the Centre\'s key id fails');
    assertEq((await S.verify(Object.assign({}, rec, { sig: rec.sig.slice(0, 40) }), pub)).result, 'altered', w + ': a cut signature fails');
    assertEq((await S.verify(rec, { keys: [] })).result, 'unknown-key', w + ': a key that is not published is unknown, not valid');
    assertEq((await S.verify(rec, null)).result, 'unknown-key', w + ': and so is everything when the key file cannot be read');

    const url = S.url('https://cestis.example.org/lms/index.html?x=1#y', rec);
    assert(url.indexOf('https://cestis.example.org/lms/index.html?certificate=WE-2026-4821-KX&n=') === 0 && url.length < 400, w + ': the QR address carries the certificate and stays short enough to scan (' + url.length + ' chars)');
    const parsed = S.parse(url.slice(url.indexOf('?')));
    assertEq((await S.verify(parsed, pub)).result, 'valid', w + ': read back from the address, it still verifies');
    assertEq(S.parse('?certificate=WE-1'), null, w + ': an unsigned address carries no signature (the old behaviour applies)');
    assertEq(S.parse('?certificate=WE-1&k=x&s=' + 'A'.repeat(300)), null, w + ': an oversized one is refused');
    assert(S.current(rec, f) && !S.current(rec, S.fields(Object.assign({}, student, { name: 'Someone Else' }), 'Welding & Fabrication Level 2')), w + ': a signature is current only while the details match');
    assert(S.publishedRevocation({ revoked: [{ no: 'we 2026 4821 kx', at: '2026-11-01' }] }, 'WE-2026-4821-KX'), w + ': a published withdrawal is found, spacing and case aside');

    console.log(w + ': the QR code and the verify door');
    // The QR address: signed while current, the plain one otherwise.
    const sb = { CESTISCore: page.core, encodeURIComponent, systemSettings: {}, location: { protocol: 'https:', origin: 'https://cestis.example.org', pathname: '/lms/index.html' },
      certTemplates: { 'Welding & Fabrication': { courseFullName: 'Welding & Fabrication Level 2' } }, certTemplateCourseMap: {} };
    vm.createContext(sb);
    vm.runInContext(['certVerifyBaseUrl', 'certVerifyUrlFor', 'getCertTemplateKey', 'certProgrammeTitle', 'certSignedFields', 'certSignedUrlFor'].map(n => extractFunction(page.src, n, w)).join('\n'), sb);
    sb.st = Object.assign({}, student, { course: 'Welding & Fabrication', certSig: rec });
    assertEq(vm.runInContext('certSignedUrlFor(st)', sb), S.url('https://cestis.example.org/lms/index.html', rec), w + ': a signed certificate\'s QR code carries the signature');
    vm.runInContext('st.name = "Renamed Person"', sb);
    assertEq(vm.runInContext('certSignedUrlFor(st)', sb), '', w + ': a certificate whose details changed after signing falls back to the plain address');
    assert(extractFunction(page.src, 'certDrawValidationQr', w).indexOf("certSignedUrlFor(student, tpl) || url") !== -1, w + ': page 2 draws the signed address when there is one');

    // The verify door, on an employer's phone: no records, nothing synced.
    const runVerify = async (signed, keys, extra) => {
      const out = { innerHTML: '', insertAdjacentHTML(_, h) { this.innerHTML += h; } };
      const input = { value: signed.no };
      const v = Object.assign({
        CESTISCore: page.core, console, Date, Promise, students: [], certDownloadApprovals: [], _certEsc: s => page.core.html.esc(s), jsArg: s => page.core.html.jsArg(s),
        document: { getElementById: id => id === 'certPortalVerifyInput' ? input : id === 'certPortalVerifyResult' ? out : null },
        fetch: async () => ({ ok: !!keys, json: async () => keys }), certSyncDone: () => false, backfillCertificateNumbers() {}
      }, extra || {});
      vm.createContext(v);
      vm.runInContext('var _certPortalSigned = null, _certKeysPromise = null, _certSignedCheck = null;\n' +
        ['certNumberKey', '_certApprovalList', '_certRoll', 'certResolveNumber', '_certNotFoundCard', '_certWrongDoorCard', 'certPortalVerify', 'certLoadPublishedKeys', 'certPortalVerifySigned']
          .map(n => extractFunction(page.src, n, w)).join('\n'), v);
      v._certPortalSigned = signed;
      vm.runInContext('certPortalVerify()', v);
      for (let i = 0; i < 20 && /Checking the Centre/.test(out.innerHTML); i++) await new Promise(r => setTimeout(r, 5));
      return out.innerHTML;
    };
    let html = await runVerify(parsed, pub);
    assert(/data-cert-verdict="valid"/.test(html) && /Certificate Verified/.test(html) && /Shanté O’Neil/.test(html) && /Welding &amp; Fabrication Level 2/.test(html), w + ': with no records on the device, a signed certificate verifies and shows what it states');
    assert(!/STU-|Student ID|Collection Status/.test(html), w + ': and nothing else about the trainee');
    html = await runVerify(Object.assign({}, parsed, { name: 'Somebody Else' }), pub);
    assert(/data-cert-verdict="altered"/.test(html) && /Do Not Match/.test(html), w + ': a tampered certificate is refused, plainly');
    html = await runVerify(parsed, Object.assign({}, pub, { revoked: [{ no: parsed.no, at: '2026-11-01T00:00:00.000Z' }] }));
    assert(/data-cert-verdict="revoked"/.test(html) && /Certificate Revoked/.test(html) && /November 01, 2026/.test(html), w + ': a withdrawal the Centre published shows as revoked, with its date');
    const withdrawn = { id: 'S1', name: parsed.name, course: 'Welding', stage: 'training', certNo: null, certNoAliases: [parsed.no], certRevokedAt: '2026-11-02T00:00:00.000Z' };
    html = await runVerify(parsed, pub, { students: [withdrawn] });
    assert(/data-cert-verdict="revoked"/.test(html), w + ': so does one this device\'s own records hold as withdrawn');
    html = await runVerify(parsed, { keys: [] });
    assert(/Sync Required/.test(html) && /could not check/.test(html), w + ': an unknown key falls back to the records lookup, and says so');
    assert(!/Certificate Verified/.test(await runVerify(parsed, null)), w + ': with no key file at all, nothing is declared verified on the signature alone');
  }

  console.log('The private key never enters the shared store');
  for (const page of PAGES) {
    const w = page.where;
    const fns = ['certSigningKeyLoad', 'certSigningKeySave', 'certSigningCreateKey', 'certSigningImportBackup', 'certSignApproved'].map(n => extractFunction(page.src, n, w)).join('\n');
    assert(fns.indexOf('CESTISStore') === -1, w + ': the signing functions never touch CESTISStore (backed up, snapshotted and synced)');
    assert(extractFunction(page.src, '_certSigningStore', w).indexOf('indexedDB.open(CERT_SIGNING_DB') !== -1 && page.src.indexOf("var CERT_SIGNING_DB = 'CESTIS_CertSigning'") !== -1, w + ': it lives in its own IndexedDB database');
    assert(extractFunction(page.src, 'approveCertDownload', w).indexOf('certSignApproved({ ids: [studentId], quiet: true })') !== -1, w + ': approving a download signs it on a device that holds the key');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
