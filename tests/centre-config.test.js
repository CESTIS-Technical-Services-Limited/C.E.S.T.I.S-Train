/* The Centre's own account ids live in ONE file, cestis-config.js.

   The sixteen Drive folder and file ids, the Google sign-in client id and the
   EmailJS ids used to be typed into about nineteen places across the pages,
   so a Centre that lost its Google account needed a developer to find them
   all (audit OPS-3). Now every page reads window.CESTIS_CONFIG.

   This fails when:
     - a page, a shared script or an Offline System copy writes one of those
       ids itself instead of reading it from the config (only cestis-config.js
       and its generated Offline System copy may hold them);
     - a page that reads the config, or that syncs (cestis-page-cloud.js), does
       not load cestis-config.js first;
     - the trainee sign-in program (trainee-gate/Gate.gs, which has its own
       copy because it runs on Google's servers, not in a page) disagrees with
       the config's sign-in client id.

   Run: node tests/centre-config.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CFG = require('../cestis-config.js');

/* ---------- 1. The file itself ---------- */
console.log('cestis-config.js holds the Centre\'s ids');
const DRIVE_ID = /^[A-Za-z0-9_-]{25,44}$/;
const folderIds = Object.keys(CFG.folders).map(k => CFG.folders[k]);
const fileIds = Object.keys(CFG.files).map(k => CFG.files[k]);
assert(folderIds.length + fileIds.length === 16, 'sixteen Drive ids (' + (folderIds.length + fileIds.length) + ')');
assert(folderIds.concat(fileIds).every(id => DRIVE_ID.test(id)), 'each one shaped like a Drive id');
assert(new Set(folderIds.concat(fileIds)).size === folderIds.length + fileIds.length, 'no two the same');
assert(/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(CFG.googleClientId), 'the Google sign-in client id');
assert(CFG.emailjs && CFG.emailjs.publicKey && /^service_/.test(CFG.emailjs.serviceId) && /^template_/.test(CFG.emailjs.templateId), 'the EmailJS public key, service and template');
assert(Object.isFrozen(CFG) && Object.isFrozen(CFG.folders) && Object.isFrozen(CFG.emailjs), 'frozen: a page can read it but never change it');
const sb = { window: {} };
vm.runInNewContext(read('cestis-config.js'), sb);
assert(sb.window.CESTIS_CONFIG && sb.window.CESTIS_CONFIG.folders.shared === CFG.folders.shared, 'in a page it is window.CESTIS_CONFIG');
assert(!/secret|password|private/i.test(read('cestis-config.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
  'and it holds nothing secret (public repository)');

/* ---------- 2. Nobody else writes them ---------- */
console.log('No page or shared script writes those ids itself');
const VALUES = folderIds.concat(fileIds, [CFG.googleClientId, CFG.emailjs.publicKey, CFG.emailjs.serviceId, CFG.emailjs.templateId]);
const ALLOWED = new Set(['cestis-config.js', 'Offline System/cestis-config.js']);
// Pages and the scripts that run in them (the Offline System's generated copies too).
const SKIP = /^(?:\.|node_modules\/|tests\/|docs\/|tools\/|trainee-gate\/|Offline System\/trainee-gate\/|Offline System\/tests\/|Offline System\/data\/|megadata\/broker-appsscript\/|User Login\/)/;
const scanned = [];
(function walk(dir) {
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach(ent => {
    const rel = dir ? dir + '/' + ent.name : ent.name;
    if (SKIP.test(rel + (ent.isDirectory() ? '/' : ''))) return;
    if (ent.isDirectory()) return walk(rel);
    if (/\.(html?|js|json|css)$/i.test(ent.name)) scanned.push(rel);
  });
})('');
assert(scanned.length > 150 && scanned.indexOf('index.html') !== -1 && scanned.indexOf('Offline System/index.html') !== -1 && scanned.indexOf('cestis-page-cloud.js') !== -1,
  'the scan reads every page and shared script, and the Offline System\'s copies (' + scanned.length + ' files)');
const hardCoded = [];
scanned.forEach(rel => {
  if (ALLOWED.has(rel)) return;
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  VALUES.forEach(v => { if (text.indexOf(v) !== -1) hardCoded.push(rel + ': ' + v); });
});
assert(hardCoded.length === 0, 'only cestis-config.js holds them — read CESTIS_CONFIG instead:\n      ' + hardCoded.join('\n      '));

/* ---------- 3. Pages load it first ---------- */
console.log('Every page that needs it loads it first');
const pages = scanned.filter(f => /\.html?$/i.test(f) && !/^Offline System\//.test(f));
let using = 0;
pages.forEach(f => {
  const src = read(f);
  const needs = src.indexOf('CESTIS_CONFIG') !== -1 || /src="cestis-page-cloud\.js/.test(src);
  if (!needs) return;
  using++;
  const at = src.search(/<script src="cestis-config\.js\?v=[0-9a-f]{8}"><\/script>/);
  assert(at !== -1, f + ' loads cestis-config.js');
  const firstUse = src.indexOf('CESTIS_CONFIG');
  const core = src.indexOf('<script src="cestis-core.js');
  const cloud = src.indexOf('<script src="cestis-page-cloud.js');
  assert(at !== -1 && (firstUse === -1 || at < firstUse) && (core === -1 || at < core) && (cloud === -1 || at < cloud),
    f + ': before anything reads it (and before cestis-core.js and cestis-page-cloud.js)');
});
assert(using >= 16, 'the pages that sync or sign in read the config (' + using + ')');
['index.html', 'School.Fee.html', 'Staff.Payslip.html', 'Staff.Clock.in.html', 'CESTIS.Cashbook.html', 'Virement.Request.html', 'Finance.Payment.Voucher.html', 'Qual-Plan-Curriculum.html'].forEach(f => {
  assert(read(f).indexOf('CESTIS_CONFIG.') !== -1, f + ' reads its ids from the config');
});
const idx = read('index.html');
assert(/CLIENT_ID: CESTIS_CONFIG\.googleClientId,\s*\n\s*FOLDER_ID: CESTIS_CONFIG\.folders\.mainBackup,/.test(idx), 'the dashboard\'s main backup and sign-in client');
assert(/window\.EMAILJS_PUBLIC_KEY = CESTIS_CONFIG\.emailjs\.publicKey;/.test(idx), 'and its EmailJS ids');

/* ---------- 4. The shared sync file reads it ---------- */
console.log('The shared sync file and the trainee sign-in agree with it');
delete require.cache[require.resolve('../cestis-page-cloud.js')];
const PC = require('../cestis-page-cloud.js');
assert(PC.FOLDER_ID === CFG.folders.shared, 'cestis-page-cloud.js syncs into the config\'s shared folder');
const gate = /var GATE_DEFAULT_CLIENT_ID = '([^']+)';/.exec(read('trainee-gate/Gate.gs'));
assert(gate && gate[1] === CFG.googleClientId,
  'trainee-gate/Gate.gs keeps the same sign-in client id as cestis-config.js — change GATE_DEFAULT_CLIENT_ID too and run `npm run build:gate`');
assert(read('trainee-gate/PASTE-GATE.gs').indexOf("var GATE_DEFAULT_CLIENT_ID = '" + CFG.googleClientId + "';") !== -1, 'and so does the file pasted into the gate');
assert(read('tools/build-offline.js') && require('../tools/build-offline.js').plan().has('cestis-config.js'), 'the Offline System ships the config');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
