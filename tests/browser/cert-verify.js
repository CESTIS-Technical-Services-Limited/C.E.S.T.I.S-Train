/* Certificate verification by an employer, in a real browser (certs-09):
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/cert-verify.js

   A fresh browser — no records, no sign-in, every outside host blocked —
   opens the address a signed certificate's QR code carries. The page must
   check the signature itself (WebCrypto) against the public key file and say
   "Certificate Verified" with what the certificate states; the same address
   with one letter of the name changed must be refused; a withdrawal published
   in the key file must show as revoked; and an old, unsigned certificate's
   address must keep the old behaviour (the records lookup, which on a device
   with no records asks for a sync). The key pair is made here for the test and
   served in place of cert-keys.json — the committed file is never touched.

   Kept out of `npm test` because it needs a browser, like the other
   tests/browser scripts. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const Core = require('../../cestis-core.js');

const ROOT = path.join(__dirname, '..', '..');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ FAIL: ' + msg); } }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
function serve(keysJson) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/cert-keys.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(keysJson.current));
      }
      const file = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async function main() {
  const S = Core.certs.sig;
  const key = await S.generateKey('browser test');
  const keys = { current: { version: 1, keys: [{ kid: key.kid, alg: 'ES256', publicJwk: key.publicJwk }], revoked: [] } };
  const student = { certNo: 'WE-2026-4821-KX', name: 'Shanté O’Neil', certDate: 'October 16, 2026' };
  const rec = await S.sign(key, S.fields(student, 'Welding & Fabrication Level 2'));

  const srv = await serve(keys);
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

  async function verdict(url, label) {
    const page = await browser.newPage();
    await page.route('**/*', route => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => {
      const el = document.getElementById('certPortalVerifyResult');
      return el && el.innerHTML && !/Checking the Centre/.test(el.innerHTML);
    }, null, { timeout: 15000 }).catch(() => {});
    const r = await page.evaluate(() => {
      const el = document.getElementById('certPortalVerifyResult');
      const card = el && el.querySelector('[data-cert-verdict]');
      return { verdict: card ? card.getAttribute('data-cert-verdict') : '', text: el ? el.innerText : '', students: (window.students || []).length,
        portalOpen: !!document.querySelector('#certPortal.active') };
    });
    ok(errors.length === 0, label + ': no page errors' + (errors.length ? ' — ' + errors.join(' | ') : ''));
    await page.close();
    return r;
  }

  console.log('A signed certificate, on a browser with no records and no sign-in');
  const signedUrl = S.url(base + '/index.html', rec);
  let r = await verdict(signedUrl, 'signed');
  ok(r.portalOpen && r.students === 0, 'the portal opened on a device holding no records');
  ok(r.verdict === 'valid' && /Certificate Verified/.test(r.text), 'the signature checks out in the browser: ' + r.verdict);
  ok(/Shanté O’Neil/.test(r.text) && /Welding & Fabrication Level 2/.test(r.text) && /WE-2026-4821-KX/.test(r.text) && /October 16, 2026/.test(r.text),
    'and the page shows what the certificate states');
  ok(!/STU-|Collection Status|Sync Required/.test(r.text), 'and nothing else about the trainee');

  console.log('The same certificate with one letter of the name changed');
  r = await verdict(signedUrl.replace('n=Shant', 'n=Chant'), 'tampered');
  ok(r.verdict === 'altered' && /Do Not Match/.test(r.text), 'it is refused: ' + r.verdict);

  console.log('A signed certificate the Centre has since withdrawn and published');
  keys.current = Object.assign({}, keys.current, { revoked: [{ no: rec.no, at: '2026-11-01T00:00:00.000Z' }] });
  r = await verdict(signedUrl, 'revoked');
  ok(r.verdict === 'revoked' && /Certificate Revoked/.test(r.text), 'it shows as revoked: ' + r.verdict);
  keys.current.revoked = [];

  console.log('An old, unsigned certificate keeps the old behaviour');
  r = await verdict(base + '/index.html?certificate=WE-2026-1234', 'unsigned');
  ok(r.portalOpen && r.verdict === '', 'the portal opens on the choice of doors, with no signature verdict');

  console.log('A certificate signed with a key that is not published');
  const stranger = await S.generateKey('not published');
  const strangerRec = await S.sign(stranger, S.fields(student, 'Welding & Fabrication Level 2'));
  r = await verdict(S.url(base + '/index.html', strangerRec), 'unknown key');
  ok(r.verdict === '' && /could not check/.test(r.text) && !/Certificate Verified/.test(r.text), 'it is not declared genuine; the records lookup is used instead');

  console.log('The administrator\'s side: a key made and kept in this browser signs an approved certificate');
  {
    const page = await browser.newPage();
    await page.route('**/*', route => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const a = await page.evaluate(async () => {
      students.push({ id: 'STU-T', name: 'Test Person', course: 'Welding', stage: 'certified', certNo: 'WE-2026-1111-AB', certDate: 'October 16, 2026' });
      certDownloadApprovals.push({ studentId: 'STU-T', approved: true, approvedDate: new Date().toISOString() });
      const k = await CESTISCore.certs.sig.generateKey('admin device');
      await certSigningKeySave(k);
      const again = await certSigningKeyLoad();
      const n = await certSignApproved({ quiet: true });
      const s = students.find(x => x.id === 'STU-T');
      return { n, kid: k.kid, loaded: again && again.kid, pub: k.publicJwk, url: certSignedUrlFor(s),
        leaked: CESTISStore.keys().filter(key => String(CESTISStore.getItem(key) || '').indexOf(k.privateJwk.d) !== -1) };
    });
    ok(errors.length === 0, 'admin page: no page errors' + (errors.length ? ' — ' + errors.join(' | ') : ''));
    ok(a.loaded === a.kid && a.n === 1 && /&s=/.test(a.url), 'the key is stored on this device, and approving-then-signing gives a signed QR address');
    ok(a.leaked.length === 0, 'the private key is in no key of the shared store (nothing a backup or sync could carry)');
    await page.close();
    keys.current = { version: 1, keys: [{ kid: a.kid, alg: 'ES256', publicJwk: a.pub }], revoked: [] };
    r = await verdict(a.url.replace(/^https?:\/\/[^/]+/, base), 'admin-signed');
    ok(r.verdict === 'valid' && /Test Person/.test(r.text), 'once its public key is published, an employer\'s browser verifies it: ' + r.verdict);
  }

  await browser.close();
  srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
