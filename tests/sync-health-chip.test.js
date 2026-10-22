/* The top bar (and each sibling page's header) says whether this computer's
   work is safe: "All saved", "Changes waiting", "Offline — saved on this
   device" or "Sign in to Google to back up" (UI preview, owner's item 5).

   What was wrong: the dashboard's cloud chip said "Connected" or "Not
   connected" and the sibling pages said nothing at all, so nobody could tell
   that their last edits existed only on this computer — an expired Google
   sign-in, a failing upload, a dropped connection — which is exactly when a
   cleared browser or a swapped PC loses work.

   The chip only READS what the save code already records; it never saves,
   syncs or retries. Pinned here: the one rule that turns those facts into
   words (CESTISCore.ui.syncHealth), that the chip code writes nothing, and
   the sibling chip's reading of the page-cloud state.

   Run: node tests/sync-health-chip.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const INDEX = read('index.html');
const CHIP = read('cestis-sync-chip.js');
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('no ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}

const H = Core.ui.syncHealth;
const NOW = Date.parse('2026-10-22T15:00:00Z');
const fmt = ms => new Date(ms).toISOString().slice(11, 16);
const base = { now: NOW, online: true, lan: false, connected: true, tokenExpiresAt: NOW + 50 * 60000, pending: false, failures: 0, lastSavedAt: NOW - 2 * 60000 };
const S = o => H(Object.assign({}, base, o), fmt);

/* ---------- 1. The four answers ---------- */
console.log('One answer from what the save code already knows');
let r = S({});
assert(r.state === 'saved' && r.tone === 'ok' && r.label === 'All saved', 'connected, nothing waiting: All saved');
assert(r.lastSaved === 'Last saved 14:58 (2 min ago)', 'with when it last saved: ' + r.lastSaved);
assert(r.advice.length === 0, 'and nothing to do');
r = S({ pending: true, pendingSince: NOW - 4 * 60000 });
assert(r.state === 'waiting' && r.tone === 'warn' && r.label === 'Changes waiting', 'unsent work while connected: Changes waiting');
assert(/since 14:56/.test(r.detail), 'since when: ' + r.detail);
r = S({ pending: true, failures: 3 });
assert(r.state === 'waiting' && r.tone === 'bad' && /did not go through/.test(r.detail), 'uploads failing: still waiting, now red, and says why');
r = S({ online: false, pending: true, pendingSince: NOW - 12 * 60000 });
assert(r.state === 'offline' && r.label === 'Offline — saved on this device' && r.tone === 'bad', 'no connection with unsent work: Offline — saved on this device');
assert(/upload by themselves/.test(r.advice.join(' ')) && /Do not clear this browser/.test(r.advice.join(' ')), 'and what to do (keep working; do not clear the browser)');
r = S({ online: false });
assert(r.state === 'offline' && r.tone === 'warn', 'offline with nothing waiting is amber, not red');
r = S({ connected: false, pending: true, pendingSince: NOW - 25 * 60000 });
assert(r.state === 'signin' && r.label === 'Sign in to Google to back up' && r.tone === 'bad', 'no Google sign-in with unsent work: Sign in to Google to back up (red)');
assert(/only on this computer/.test(r.detail) && /Connect/.test(r.advice[0]), 'saying the work is only here, and how to connect');
r = S({ connected: false });
assert(r.state === 'signin' && r.tone === 'warn', 'no Google sign-in, nothing waiting: amber');

console.log('The Centre\'s own network needs no Google sign-in');
r = S({ lan: true, connected: false });
assert(r.state === 'saved' && /Centre’s server/.test(r.detail), 'on the Centre\'s network, reaching its server: All saved (to the server)');
r = S({ lan: true, connected: false, lanTrouble: true, pending: true });
assert(r.state === 'offline' && /server window/.test(r.advice[0]), 'not reaching the server: Offline, check the server window');
r = S({ lan: true, online: false });
assert(r.state === 'saved', 'the browser\'s internet flag does not matter on the Centre\'s network');

console.log('A Google sign-in about to end is said in time');
r = S({ tokenExpiresAt: NOW + 6 * 60000 });
assert(r.state === 'saved' && r.tone === 'warn' && /ends at 15:06/.test(r.advice.join(' ')), 'six minutes left: amber, with the time it ends');
r = S({ tokenExpiresAt: NOW + 40 * 60000 });
assert(r.tone === 'ok' && r.advice.length === 0, 'forty minutes left: nothing said');
assert(S({ lastSavedAt: null }).lastSaved === 'No save recorded since this page was opened', 'never saved this visit: said plainly');
assert(/hours? ago/.test(S({ lastSavedAt: NOW - 3 * 3600e3 }).lastSaved), 'old saves read in hours');

/* ---------- 2. The dashboard chip reads; it never writes ---------- */
console.log('The dashboard chip sits in the top bar and only reads');
const topbar = INDEX.slice(INDEX.indexOf('<header class="topbar">'), INDEX.indexOf('</header>', INDEX.indexOf('<header class="topbar">')));
assert(/<button type="button" class="sync-chip[^"]*" id="syncChip" onclick="toggleSyncChipPanel\(event\)" aria-expanded="false" aria-controls="syncChipPanel">/.test(topbar), 'a real button that says it opens a panel');
assert(/id="syncChipPanel" role="dialog"[^>]*hidden/.test(topbar), 'the panel is a labelled dialog, closed at first');
assert(topbar.indexOf('id="syncChip"') < topbar.indexOf('<!-- Cloud Sync Dropdown -->'), 'beside the cloud button');
['syncChipInputs', 'refreshSyncChip', 'toggleSyncChipPanel'].forEach(fn => {
  const body = extractFunction(INDEX, fn);
  assert(!/setItem\(|removeItem\(|saveState\(|autoSaveToAllFolders|saveToCloud|syncFromCloud|mergeFromCloud|saveNow\(|loadNow\(/.test(body), fn + '() writes nothing and starts no sync');
});
assert(/CESTISCore\.ui\.syncHealth\(syncChipInputs\(\)\)/.test(extractFunction(INDEX, 'refreshSyncChip')), 'the words come from the shared rule');
assert(/typeof CESTISCore\.ui\.syncHealth !== 'function'/.test(extractFunction(INDEX, 'refreshSyncChip')), 'and a cached older cestis-core.js only hides the chip');
const inputs = extractFunction(INDEX, 'syncChipInputs');
['cestisPendingUpload', '_consecutiveCloudSaveFailures', 'schoolDashboardGoogleTokenExpiry', 'isCloudConnected', 'navigator.onLine', 'CESTISPageCloud.status()'].forEach(k =>
  assert(inputs.indexOf(k) !== -1, 'it reads ' + k));

/* ---------- 3. The sibling chip ---------- */
console.log('Each sibling page carries the chip in its header, after its page-cloud');
['School.Fee.html', 'CESTIS.Cashbook.html', 'Staff.Payslip.html', 'Staff.Clock.in.html', 'Virement.Request.html', 'Income.Expenditure.html',
 'Payments.Invoices.html', 'Finance.Invoice.html', 'Finance.Quote.html', 'Finance.Purchase.Order.html', 'Finance.Payment.Voucher.html'].forEach(f => {
  const src = read(f);
  assert((src.match(/<span data-cestis-sync-chip><\/span>/g) || []).length === 1, f + ': one chip slot');
  assert(/<script src="cestis-page-cloud\.js\?v=[^"]+"><\/script>\n<script src="cestis-sync-chip\.js\?v=[^"]+"><\/script>/.test(src), f + ': the chip script loads right after cestis-page-cloud.js');
});
assert(!/setItem\(|removeItem\(|\.push\(\)|saveNow|loadNow|pull\(|schedulePush/.test(CHIP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'cestis-sync-chip.js writes nothing and starts no sync');

console.log('The sibling chip reads the page-cloud state the way it means');
function sibling(opts) {
  const store = new Map(Object.entries(opts.store || {}));
  const sb = {
    Date, Math, JSON, Object, Array, String, Number, isNaN, setInterval() {}, addEventListener() {},
    navigator: { onLine: opts.online !== false },
    document: { readyState: 'complete', getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
    CESTISStore: { getItem: k => (store.has(k) ? store.get(k) : null) },
    CESTISCore: Core,
    CESTISPageCloud: { now: () => new Date().toISOString(), lan: () => Promise.resolve(false), _pages: opts.pages || [] }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(CHIP, sb);
  return sb;
}
const later = () => new Date(Date.now() + 5000).toISOString();
const page = (stamps, state) => ({ spec: { file: 'F.json' }, state: Object.assign({ connected: true }, state || {}), stamps: () => stamps });
let sb = sibling({ pages: [page({ cesti_virements: later() })] });
let inp = sb.CESTISSyncChip.inputs();
assert(!inp.connected && inp.pending && inp.pendingSince, 'no Google sign-in and an edit since the page opened: waiting, with since when');
assert(Core.ui.syncHealth(inp).state === 'signin' && Core.ui.syncHealth(inp).tone === 'bad', '→ Sign in to Google to back up, red');
sb = sibling({ pages: [page({ cesti_virements: '2026-01-01T00:00:00.000Z' })] });
assert(!sb.CESTISSyncChip.inputs().pending, 'an edit from before the page was opened is not counted as this visit\'s');
const tok = { schoolDashboardGoogleAccessToken: 't', schoolDashboardGoogleTokenExpiry: new Date(Date.now() + 3600e3).toISOString() };
sb = sibling({ store: tok, pages: [page({ cesti_virements: later() }, { lastPush: new Date().toISOString() })] });
inp = sb.CESTISSyncChip.inputs();
assert(inp.connected && !inp.pending && Core.ui.syncHealth(inp).state === 'saved', 'signed in to Google: each edit goes up within seconds — All saved');
const failing = page({}, { lastPush: '2026-10-22T10:00:00.000Z', error: 'http-500' });
sb = sibling({ store: tok, pages: [failing] });
inp = sb.CESTISSyncChip.inputs();
assert(inp.failures === 1 && inp.pending && Core.ui.syncHealth(inp).tone === 'bad', 'an upload that failed: Changes waiting, red');
failing.state.lastPush = '2026-10-22T10:05:00.000Z';
inp = sb.CESTISSyncChip.inputs();
assert(inp.failures === 0 && !inp.pending, 'once a later upload goes through, the old error no longer counts (page-cloud leaves it set)');
sb = sibling({ online: false, store: tok, pages: [page({ cesti_virements: later() })] });
assert(Core.ui.syncHealth(sb.CESTISSyncChip.inputs()).state === 'offline', 'no connection: Offline — saved on this device');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
