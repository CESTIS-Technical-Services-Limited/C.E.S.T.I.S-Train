/* On the Centre's own network a trainee's own device can build their
   certificate: the design's background images are kept on the Centre's
   server, not only on the PC that uploaded them.

   What happened (the end-to-end flow test, step 6, on the Offline System):
   the administrator uploaded the certificate design; the trainee, certified
   and approved, pressed "Download Certificate" on her phone and was told "No
   certificate template found … Please contact administration." The design's
   two background images live in the uploading PC's IndexedDB
   (CESTIS_CertImages) and otherwise travel only through Google Drive — and the
   Centre's network has no Drive. She had to collect it at the office PC.

   Pinned here, against the REAL Offline System server on a scratch data
   folder and the real cestis-core.js / cestis-page-cloud.js, with the
   dashboard's real certImageSaveToLan / certImageLoadFromLan /
   certImagesPublishToLan (and helpers) extracted from index.html:
     - a staff device's upload puts each page on the server, one file per
       page; another device with nothing in its IndexedDB loads both, caches
       them, and has the template's images;
     - only an image data: URL, at most CERT_IMAGE_LAN_MAX characters, is
       written or used; a trainee's device writes nothing;
     - an image the server already holds is not sent again (no new copy in
       the server's history folder);
     - a PC holding designs uploaded before this publishes the missing ones;
     - online (GitHub Pages) none of it makes a single request;
     - the certificate PDF, its preview and the template save all take this
       path (source checks), Drive staying the online path.

   Run: node tests/lan-cert-images.test.js */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

const ROOT = path.join(__dirname, '..');
const OFF = path.join(ROOT, 'Offline System');
const CORE_SRC = fs.readFileSync(path.join(ROOT, 'cestis-core.js'), 'utf8');
const PC_SRC = fs.readFileSync(path.join(ROOT, 'cestis-page-cloud.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
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
const MAX_SRC = (/var CERT_IMAGE_LAN_MAX = [^;]+;/.exec(INDEX) || [''])[0];
const FNS = ['certImageLanFile', 'certImageLanSafe', 'certImageLanFiles', 'certImageSaveToLan', 'certImageLoadFromLan',
  'certImagesPublishToLan'].map(n => extractFunction(INDEX, n)).join('\n\n');

/* ------------------------------------------------------------ the server */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-certimg-'));
const DATA = path.join(tmp, 'data'), CERT = path.join(tmp, 'cert');
const PORT = 9000 + Math.floor(Math.random() * 900);
let server = null;
function startServer() {
  server = spawn(process.execPath, ['cestis-offline-server.js'], {
    cwd: OFF, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { CESTIS_HTTP: '1', CESTIS_PORT: String(PORT), CESTIS_DATA_DIR: DATA, CESTIS_CERT_DIR: CERT })
  });
  return (async () => {
    for (let i = 0; i < 60; i++) {
      await wait(100);
      try { const r = await fetch('http://127.0.0.1:' + PORT + '/_cestis/health'); if (r.ok) return; } catch (e) {}
    }
    throw new Error('offline server did not start');
  })();
}
async function stopServer() {
  if (!server) return;
  const s = server; server = null;
  await new Promise(r => { s.on('exit', r); s.kill(); });
}

/* ------------------------------------------------------------ a device */
const COURSE = 'Welding & Fabrication';
function device(role, opts) {
  opts = opts || {};
  const map = new Map();
  const log = { requests: [], idb: [] };
  const ctx = {
    console: { log() {}, warn() {}, error: console.error }, JSON, Date, Math, Promise, Object, Array, String, Number, Boolean, RegExp, Error, Map, Set,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, setTimeout, clearTimeout, setInterval: () => 0,
    location: opts.location || { protocol: 'http:', hostname: '127.0.0.1', port: String(PORT) },
    fetch: opts.fetch || ((u, o) => { log.requests.push(((o && o.method) || 'GET') + ' ' + u); return fetch('http://127.0.0.1:' + PORT + u, o); }),
    addEventListener: () => {},
    CESTISStore: { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); },
                   removeItem: k => { map.delete(k); }, keys: () => Array.from(map.keys()) }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(CORE_SRC, ctx);
  vm.runInContext(PC_SRC, ctx);
  ctx.currentRole = role;
  ctx.currentLoggedInUser = { id: 'U-' + role, username: role };
  ctx.certTemplates = opts.templates || { [COURSE]: { courseFullName: 'Welding and Fabrication Level 2' } };
  ctx.certImageSave = (course, page, data) => { log.idb.push([course, page, data.length]); };
  ctx.ensureCertImagesLoaded = () => Promise.resolve();
  vm.runInContext(MAX_SRC + '\n' + FNS, ctx);
  return { ctx, log, run: code => vm.runInContext(code, ctx) };
}
// A small but real PNG, as FileReader.readAsDataURL hands it over.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG2 = PNG.replace('DwAEhQGAhKmMIQ', 'DwAEhQGAhKmMIR');
const history = file => { try { return fs.readdirSync(path.join(DATA, '.history', file)).length; } catch (e) { return 0; } };

(async () => {
  try {
    await startServer();

    /* ---------- 1. The office PC uploads the design ---------- */
    console.log('The office PC\'s upload reaches the Centre\'s server, one file per page');
    const office = device('admin');
    assertEq(await office.run('certImageSaveToLan(' + JSON.stringify(COURSE) + ', "bgPage1", ' + JSON.stringify(PNG) + ')'), 'saved', 'page 1 is saved');
    assertEq(await office.run('certImageSaveToLan(' + JSON.stringify(COURSE) + ', "bgPage2", ' + JSON.stringify(PNG2) + ')'), 'saved', 'page 2 is saved');
    const f1 = office.run('certImageLanFile(' + JSON.stringify(COURSE) + ', "bgPage1")');
    const f2 = office.run('certImageLanFile(' + JSON.stringify(COURSE) + ', "bgPage2")');
    assert(/^CESTIS_CertImage_[A-Za-z0-9-]+_bgPage1\.json$/.test(f1), 'its file is named after the design, safely (' + f1 + ')');
    const onDisk = JSON.parse(fs.readFileSync(path.join(DATA, f1), 'utf8'));
    assertEq(onDisk.data.image, PNG, 'the server holds the image itself');
    assertEq(JSON.parse(fs.readFileSync(path.join(DATA, f2), 'utf8')).data.image, PNG2, 'and page 2 in its own file');

    /* ---------- 2. Ama's phone builds the certificate ---------- */
    console.log('A trainee\'s phone, with nothing in its IndexedDB, has the design');
    const phone = device('student');
    assertEq(await phone.run('certImageLoadFromLan(' + JSON.stringify(COURSE) + ')'), true, 'both pages load from the Centre\'s server');
    assertEq(phone.ctx.certTemplates[COURSE].bgPage1, PNG, 'page 1 is the uploaded image');
    assertEq(phone.ctx.certTemplates[COURSE].bgPage2, PNG2, 'and page 2');
    assertEq(phone.log.idb.length, 2, 'and both are kept in this device\'s IndexedDB for next time');
    assert(phone.log.requests.every(r => !/^GET \/_cestis\/data\/CESTIS_CertImage_/.test(r) || r.indexOf(f1) !== -1 || r.indexOf(f2) !== -1),
      'only the design\'s own files are read');
    assertEq(await phone.run('certImageLoadFromLan("Some Other Course")'), false, 'a course with no template there loads nothing');
    const before = phone.log.requests.length;
    assertEq(await phone.run('certImageLoadFromLan("Plumbing")'), false, 'a design not on the server is not there');
    assert(phone.log.requests.slice(before).every(r => !/CESTIS_CertImage_/.test(r)), 'and is not even asked for (no 404 for the console)');

    /* ---------- 3. Only images, only so big, only from staff ---------- */
    console.log('Only an image is written or used, up to the size limit, and never from a trainee\'s device');
    assertEq(await phone.run('certImageSaveToLan("Plumbing", "bgPage1", ' + JSON.stringify(PNG) + ')'), 'off', 'a trainee\'s device writes nothing');
    assertEq(fs.existsSync(path.join(DATA, phone.run('certImageLanFile("Plumbing", "bgPage1")'))), false, 'and nothing reached the server');
    for (const bad of ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
                       'data:image/png;base64,iVBOR"><script>']) {
      assertEq(await office.run('certImageSaveToLan("Plumbing", "bgPage1", ' + JSON.stringify(bad) + ')'), 'failed', 'refused: ' + bad.slice(0, 30));
    }
    const huge = 'data:image/png;base64,' + 'A'.repeat(office.ctx.CERT_IMAGE_LAN_MAX + 10);
    assertEq(await office.run('certImageSaveToLan("Plumbing", "bgPage1", ' + JSON.stringify(huge) + ')'), 'too-large', 'an image over the limit is refused, and says so');
    // A file someone else put on the server is not used unless it is an image.
    const planted = office.run('certImageLanFile("Plumbing", "bgPage1")');
    fs.writeFileSync(path.join(DATA, planted), JSON.stringify({ version: '1.0', file: planted, stamps: { image: '2026-10-22T00:00:00Z' },
      data: { image: 'data:text/html;base64,PHNjcmlwdD4=' } }));
    const reader = device('student', { templates: { Plumbing: {} } });
    assertEq(await reader.run('certImageLoadFromLan("Plumbing")'), false, 'a planted non-image is never used');
    assertEq(reader.ctx.certTemplates.Plumbing.bgPage1, undefined, 'and never reaches the template');

    /* ---------- 4. No copies for nothing ---------- */
    console.log('Saving the same design again sends nothing');
    const h = history(f1);
    office.log.requests.length = 0;
    assertEq(await office.run('certImageSaveToLan(' + JSON.stringify(COURSE) + ', "bgPage1", ' + JSON.stringify(PNG) + ')'), 'same', 'already there');
    assert(!office.log.requests.some(r => /^PUT /.test(r)), 'no upload (' + office.log.requests.join('; ') + ')');
    assertEq(history(f1), h, 'and no new version in the server\'s history folder');
    assertEq(await office.run('certImageSaveToLan(' + JSON.stringify(COURSE) + ', "bgPage1", ' + JSON.stringify(PNG2) + ')'), 'saved', 'a changed design is sent');
    assertEq(JSON.parse(fs.readFileSync(path.join(DATA, f1), 'utf8')).data.image, PNG2, 'and replaces the old one');

    /* ---------- 5. Designs uploaded before this ---------- */
    console.log('A PC holding designs from before publishes the ones the server lacks');
    const older = device('admin', { templates: { Cosmetology: { bgPage1: PNG, bgPage2: PNG2 }, [COURSE]: { bgPage1: PNG2 } } });
    assertEq(await older.run('certImagesPublishToLan()'), 2, 'the two missing pages go up; the one already there does not');
    assertEq(await older.run('certImagesPublishToLan()'), 0, 'and next time there is nothing to send');
    const cos = device('student', { templates: { Cosmetology: {} } });
    assertEq(await cos.run('certImageLoadFromLan("Cosmetology")'), true, 'its trainees\' devices now have that design too');
    assertEq(await device('student').run('certImagesPublishToLan()'), 0, 'a trainee\'s device publishes nothing');

    /* ---------- 6. Online, nothing of this runs ---------- */
    console.log('Online (GitHub Pages) not one request is made');
    let calls = 0;
    const online = device('admin', { location: { protocol: 'https:', hostname: 'cestis.github.io', port: '' },
      fetch: () => { calls++; return Promise.reject(new Error('no network in this test')); } });
    assertEq(await online.run('certImageSaveToLan(' + JSON.stringify(COURSE) + ', "bgPage1", ' + JSON.stringify(PNG) + ')'), 'off', 'saving is for the Centre\'s network');
    assertEq(await online.run('certImageLoadFromLan(' + JSON.stringify(COURSE) + ')'), false, 'so is loading');
    assertEq(await online.run('certImagesPublishToLan()'), 0, 'and publishing');
    assertEq(calls, 0, 'with no request at all');

    /* ---------- 7. Every path that needs the design takes this one ---------- */
    console.log('The PDF, its preview and the template save all use the Centre\'s server');
    const gen = extractFunction(INDEX, 'generateCertificatePDF');
    assert(gen.indexOf('certImageLoadFromLan(certKey)') !== -1 && gen.indexOf('certImageLoadFromLan(certKey)') < gen.indexOf('certImageLoadFromDrive(certKey'),
      'the PDF tries the Centre\'s server after this device and before Google Drive');
    const prev = extractFunction(INDEX, 'certLoadTemplateFor');
    assert(prev.indexOf('certImageLoadFromLan(certKey)') !== -1 && prev.indexOf('certImageLoadFromLan(certKey)') < prev.indexOf('certImageLoadFromDrive(certKey'),
      'so does the preview');
    const save = extractFunction(INDEX, 'saveCertTemplate');
    assert(/certImageSaveToLan\(_certTplEditingCourse, pg\[0\], pg\[1\]\)/.test(save) && save.indexOf('certImageSaveToDrive(') !== -1,
      'and Save Template sends the images to the Centre\'s server as well as to Drive');
    assert(/certImagesPublishToLan\(\)/.test(extractFunction(INDEX, 'enterApp')), 'a staff sign-in publishes designs from before');
  } catch (e) {
    failed++;
    console.error(e && e.stack || e);
  } finally {
    await stopServer();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
