/* The screens never say where the Centre's information is synced from or kept.

   The owner's rule: "in no shape or form should this be indicated to users".
   Before this test, the sign-in screen said "Sync from Cloud before logging
   in — Pull the latest data from the Cloud", the top bar showed a ☁️ "Cloud"
   menu ("Save to Cloud", "Sync from Cloud"), messages named Google Drive, the
   Centre's server, the internet, IndexedDB and the MegaData broker, and the
   finance apps each carried a "Connect to Google Drive" dialog. People now see
   what happened and what to do — "Sync Now", "Up to date", "Not synced yet",
   "Saved", "Could not sync — try again or ask the office" — never the place.

   tools/scan-ui-wording.js reads every page, fragment and browser-side
   library the way a person sees it (page text, titles, alt / aria-label /
   placeholder, button values, and every string the code puts on screen —
   console messages, comments, storage keys, ids, class names and URLs are
   code and are skipped). This test proves the scanner tells the two apart on
   small samples, then fails on ANY forbidden word anywhere in the product.

   Run: node tests/ui-no-sync-source-wording.test.js */
'use strict';

const scan = require('../tools/scan-ui-wording.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const html = s => scan.scanHtml(s, 'sample.html');
const js = s => scan.scanJsFile(s, 'sample.js');
const words = hits => hits.map(h => h.rule).sort().join(',');

/* ---------- 1. It finds the words where a person sees them ---------- */
console.log('The scanner finds the words on screen');
assert(words(html('<strong>Sync from Cloud before logging in</strong>')) === 'cloud', 'page text');
assert(words(html('<span class="sync-icon">☁️</span>')) === 'cloud-emoji', 'the ☁️ used as a sync sign');
assert(words(html('<span>&#9729;</span>')) === 'cloud-emoji', 'the cloud written as an HTML entity');
assert(words(html('<button title="Open in Drive">↗</button>')) === 'drive', 'a title attribute');
assert(words(html('<input placeholder="your.email@gmail.com">')) === 'gmail', 'a placeholder');
assert(words(html('<input type="button" value="Upload to Google Drive">')) === 'drive,google', "a button's value");
assert(words(html('<title>Device Setup | CESTIS MegaData</title>')) === 'megadata', 'the page title');
assert(words(html('<button onclick="showToast(\'Saved to the cloud\')">Save</button>')) === 'cloud', 'a message inside an onclick');
assert(words(js("showToast('Data saved to Google Drive');")) === 'drive,google', 'a toast');
assert(words(js("alert(\"Could not reach the Centre's server\");")) === 'server', 'an alert');
assert(words(js("if (!ok) confirm('Pull from the internet?');")) === 'internet', 'a confirm');
assert(words(js("el.textContent = 'Cloud';")) === 'cloud', 'one word put on screen with textContent');
assert(words(js("el.innerHTML = '<b>Cloud</b> backup ready';")) === 'cloud', 'HTML built in a string');
assert(words(js("box.innerHTML = `<div class=\"x\">${n} file(s) uploaded to Drive</div>`;")) === 'drive', 'a template literal');
assert(words(js("var m = 'Stored in IndexedDB on this computer';")) === 'indexeddb', 'IndexedDB in a sentence');
assert(words(js("var m = 'Kept in this browser\\'s storage';")) === 'browser-storage', "this browser's storage");
assert(words(js("var m = 'Connecting to the broker…';")) === 'broker', 'the broker');
assert(words(js("var m = 'Uses EmailJS and PeerJS';")) === 'emailjs,peerjs', 'EmailJS and PeerJS');
assert(words(js("var m = 'Join over the LAN';")) === 'lan', 'the LAN');
assert(words(js("var m = 'Reads from the Centre\\'s network';")) === 'network', "the Centre's network");
assert(words(js("var m = 'Open the Offline System folder';")) === 'offline-system', 'the Offline System');
assert(words(js("var m = 'Uses Apps Script';")) === 'apps-script', 'Apps Script');

/* ---------- 2. …and leaves code alone ---------- */
console.log('The scanner leaves code alone');
assert(js("console.log('[Cloud] saved to Google Drive');").length === 0, 'console messages');
assert(js("console.warn('Drive ' + 'cloud sync failed', e);").length === 0, 'console messages built from pieces');
assert(js("// Save to Google Drive\n/* the cloud backup */ var a = 1;").length === 0, 'comments');
assert(js("localStorage.getItem('schoolDashboardGoogleAccessToken');").length === 0, 'storage keys');
assert(js("var o = { 'Google Drive': 1, cloud: 2 };").length === 0, 'object keys');
assert(js("dot.className = 'cloud-status-dot connected';").length === 0, 'class names');
assert(js("document.getElementById('cloudStatusText');").length === 0, 'element ids');
assert(js("fetch('https://www.googleapis.com/drive/v3/files?q=' + q);").length === 0, 'URLs');
assert(js("if (/cloud|drive/i.test(s)) mode = 'cloud';").length === 0, 'regular expressions and code values');
assert(js("if (source === 'Drive') x();").length === 0, 'a code value compared');
assert(html('<div id="cloudConnected" class="cloud-dropdown" data-src="drive"></div>').length === 0, 'ids, classes and data attributes');
assert(html('<!-- Cloud Sync Dropdown --><div></div>').length === 0, 'HTML comments');
assert(html('<style>.cloud-btn{color:red}</style>').length === 0, 'stylesheets');
assert(html('<a href="https://developers.google.com/oauthplayground">Open the token page</a>').length === 0, 'link addresses');

/* ---------- 3. A video or relay server address may be named in Settings ---------- */
console.log('Settings may name a video or relay server address');
assert(html('<label>Video server address (optional)</label>').length === 0, '"Video server address"');
assert(html('<label>Relay server (optional)</label>').length === 0, '"Relay server"');
assert(words(html("<p>Check the server window is open</p>")) === 'server', 'any other server is still caught');

/* ---------- 4. The tokenizer reads real code the way JavaScript does ---------- */
console.log('The tokenizer is not fooled by regular expressions, division or templates');
{
  const t = scan.tokenizeJs("var a = b / 2, r = /'x\"/g; var s = `a ${ { k: '}' }.k } b` + 'z';")
    .filter(x => x.t === 'str' || x.t === 'tpl').map(x => x.v);
  assert(JSON.stringify(t) === JSON.stringify(['a ', '}', ' b', 'z']), 'strings found exactly: ' + JSON.stringify(t));
}

/* ---------- 5. The allow-list is small and holds no prose ---------- */
console.log('The allow-list is short, explained, and technical values only');
assert(scan.ALLOW.length <= 12, 'at most a dozen allowed values (' + scan.ALLOW.length + ')');
scan.ALLOW.forEach(a => {
  assert(a.file && a.text && a.why, 'every allowed value names its file, its exact text and why: ' + JSON.stringify(a));
  assert(/^(https?:\/\/\S+|\S+)$/.test(a.text), 'an allowed value is one technical token or a URL, never a sentence: ' + JSON.stringify(a.text));
});

/* ---------- 6. Nothing on any screen names the place ---------- */
console.log('No page, fragment or on-screen message says where information is synced from or kept');
{
  const files = scan.listFiles();
  ['index.html', 'Pages/Administration.html', 'School.Fee.html', 'CESTIS.Cashbook.html', 'Staff.Payslip.html',
    'Staff.Clock.in.html', 'Virement.Request.html', 'MegaData-Admin.html', 'cestis-page-cloud.js', 'sw.js',
    'megadata/pages/admin-model.js'].forEach(f => assert(files.indexOf(f) !== -1, 'the scan reads ' + f));
  assert(!files.some(f => /^(docs|tests|vendor|tools)\//.test(f) || /\.md$/.test(f)), 'and not the developer-only files');
  const hits = scan.scanRepo();
  assert(hits.length === 0, hits.length + ' place(s) on screen still say where information is synced from or kept ' +
    '(run `node tools/scan-ui-wording.js` for the list):\n      ' +
    hits.slice(0, 40).map(h => h.file + ':' + h.line + ' [' + h.rule + '] ' + h.text.slice(0, 110)).join('\n      '));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
