/* The top bar (and each sibling page's header) says whether this computer's
   work is safe: "All saved", "Changes waiting to sync", "Not synced yet —
   your work is kept on this computer" or "Sync needs attention — ask the
   office", with a check or circular arrows (UI preview, owner's item 5).
   By the owner's rule none of it ever says where the work syncs to or from
   (the first version said "Sign in to Google to back up", "the Centre's
   Google Drive", "the Centre's server"); section 1b pins that for every
   situation the chip can meet.

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
assert(r.state === 'saved' && r.tone === 'ok' && r.label === 'All saved' && r.icon === 'check', 'connected, nothing waiting: All saved, with a check');
assert(r.lastSaved === 'Last synced 14:58 (2 min ago)', 'with when it last synced: ' + r.lastSaved);
assert(r.advice.length === 0, 'and nothing to do');
r = S({ pending: true, pendingSince: NOW - 4 * 60000 });
assert(r.state === 'waiting' && r.tone === 'warn' && r.label === 'Changes waiting to sync' && r.icon === 'sync', 'unsent work while connected: Changes waiting to sync, circular arrows');
assert(/since 14:56/.test(r.detail), 'since when: ' + r.detail);
r = S({ pending: true, failures: 3 });
assert(r.state === 'waiting' && r.tone === 'bad' && /did not go through/.test(r.detail) && /ask the office/.test(r.advice[0]), 'syncs failing: still waiting, now red, says why and who helps');
r = S({ online: false, pending: true, pendingSince: NOW - 12 * 60000 });
assert(r.state === 'offline' && r.label === 'Not synced yet — your work is kept on this computer' && r.tone === 'bad', 'no connection with unsent work: Not synced yet — your work is kept on this computer');
assert(/sync by themselves/.test(r.advice.join(' ')) && /ask the office/.test(r.advice.join(' ')) && /Do not clear this browser/.test(r.advice.join(' ')),
  'and what to do (keep working; ask the office if it stays; do not clear the browser)');
r = S({ online: false });
assert(r.state === 'offline' && r.tone === 'warn', 'cannot sync with nothing waiting is amber, not red');
r = S({ connected: false, pending: true, pendingSince: NOW - 25 * 60000 });
assert(r.state === 'attention' && r.label === 'Sync needs attention — ask the office' && r.tone === 'bad', 'not set up to sync, with unsent work: Sync needs attention — ask the office (red)');
assert(/kept on this computer only/.test(r.detail) && /ask the office/i.test(r.advice[0]), 'saying the work is only here, and who sets it up');
r = S({ connected: false });
assert(r.state === 'attention' && r.tone === 'warn', 'not set up to sync, nothing waiting: amber');

console.log('On the Centre\'s own network no sign-in is needed (the words do not change)');
r = S({ lan: true, connected: false });
assert(r.state === 'saved' && r.label === 'All saved' && r.detail === 'Everything on this computer has synced.', 'on the Centre\'s network, syncing: All saved');
r = S({ lan: true, connected: false, lanTrouble: true, pending: true });
assert(r.state === 'offline' && r.label === 'Not synced yet — your work is kept on this computer' && /ask the office/.test(r.advice.join(' ')), 'not reaching it: Not synced yet, ask the office if it stays');
r = S({ lan: true, online: false });
assert(r.state === 'saved', 'the browser\'s own connection flag does not matter on the Centre\'s network');

console.log('A sign-in about to end is said in time');
r = S({ tokenExpiresAt: NOW + 6 * 60000 });
assert(r.state === 'saved' && r.tone === 'warn' && /renewed by 15:06/.test(r.advice.join(' ')) && /ask the office/.test(r.advice.join(' ')), 'six minutes left: amber, with the time and who renews it');
r = S({ tokenExpiresAt: NOW + 40 * 60000 });
assert(r.tone === 'ok' && r.advice.length === 0, 'forty minutes left: nothing said');
assert(S({ lastSavedAt: null }).lastSaved === 'Not synced since this page was opened', 'never synced this visit: said plainly');
assert(/hours? ago/.test(S({ lastSavedAt: NOW - 3 * 3600e3 }).lastSaved), 'old syncs read in hours');

/* ---------- 1b. Never where ---------- */
// The owner's rule: nothing on screen says where the Centre's records come
// from or are kept — no Cloud (or a cloud icon), Google, Drive, Gmail, the
// Centre's server or network, the Offline System, the internet, EmailJS,
// PeerJS, the broker/MegaData.
const SOURCE_WORDS = /cloud|☁|google|\bdrive\b|gmail|server|network|\blan\b|offline|internet|emailjs|peerjs|broker|megadata/i;
console.log('No answer, in any situation, says where the work syncs to or from');
const seen = new Set();
let combos = 0;
[false, true].forEach(lan => [false, true].forEach(lanTrouble => [true, false].forEach(online => [true, false].forEach(connected =>
  [false, true].forEach(pending => [0, 2].forEach(failures => [null, NOW + 5 * 60000].forEach(tokenExpiresAt => [null, NOW - 9 * 60000].forEach(lastSavedAt => {
    const o = S({ lan, lanTrouble, online, connected, pending, pendingSince: pending ? NOW - 7 * 60000 : null, failures, tokenExpiresAt, lastSavedAt });
    combos++;
    seen.add(o.state + '|' + o.label);
    const words = [o.label, o.detail, o.lastSaved].concat(o.advice).join(' \n ');
    if (SOURCE_WORDS.test(words)) assert(false, 'names a place: ' + JSON.stringify(o));
    assert(o.icon === (o.state === 'saved' ? 'check' : 'sync'), 'icon for ' + o.state);
  }))))))));
assert(combos === 256, 'every combination was tried (' + combos + ')');
console.log('The chip shows the words before the dash; the panel and screen readers get the whole sentence');
assert(S({}).chip === 'All saved' && S({ pending: true }).chip === 'Changes waiting to sync', 'short answers are shown whole');
assert(S({ online: false }).chip === 'Not synced yet' && S({ connected: false }).chip === 'Sync needs attention', 'long ones show the words before the dash');
assert([...seen].sort().join(' / ') === ['attention|Sync needs attention — ask the office', 'offline|Not synced yet — your work is kept on this computer',
  'saved|All saved', 'waiting|Changes waiting to sync'].join(' / '), 'exactly four answers, in neutral words: ' + [...seen].sort().join(' / '));
console.log('The icon is a check or circular arrows — never a cloud');
const iconCheck = Core.ui.syncIcon('check'), iconSync = Core.ui.syncIcon('sync');
assert(/^<svg [^>]*aria-hidden="true"/.test(iconCheck) && /<polyline points="22 4 12 14.01 9 11.01"\/>/.test(iconCheck), 'a check mark for All saved');
assert(/^<svg [^>]*aria-hidden="true"/.test(iconSync) && /<polyline points="23 4 23 10 17 10"\/>/.test(iconSync) && /<polyline points="1 20 1 14 7 14"\/>/.test(iconSync), 'two circular arrows otherwise');
assert(Core.ui.syncIcon('anything') === iconSync, 'an unknown name falls back to the arrows');
assert(!/cloud|☁|<text|<image|href/i.test(iconCheck + iconSync), 'no cloud, text, image or link inside them');

/* ---------- 2. The dashboard chip reads; it never writes ---------- */
console.log('The dashboard chip sits in the top bar and only reads');
const topbar = INDEX.slice(INDEX.indexOf('<header class="topbar">'), INDEX.indexOf('</header>', INDEX.indexOf('<header class="topbar">')));
assert(/<button type="button" class="sync-chip[^"]*" id="syncChip" onclick="toggleSyncChipPanel\(event\)" aria-expanded="false" aria-controls="syncChipPanel">/.test(topbar), 'a real button that says it opens a panel');
assert(/id="syncChipPanel" role="dialog"[^>]*hidden/.test(topbar), 'the panel is a labelled dialog, closed at first');
assert(topbar.indexOf('id="syncChip"') < topbar.indexOf('<!-- Cloud Sync Dropdown -->'), 'beside the Connect button');
const chipHtml = topbar.slice(topbar.indexOf('<div class="sync-chip-wrap"'), topbar.indexOf('<!-- Cloud Sync Dropdown -->')).replace(/<!--[\s\S]*?-->/g, '');
assert(/<span class="sync-chip-icon" id="syncChipIcon" aria-hidden="true"><\/span>/.test(chipHtml) && !/sync-chip-dot/.test(chipHtml), 'the chip carries an icon slot (no bare dot)');
assert(chipHtml.length > 200 && !SOURCE_WORDS.test(chipHtml), 'the chip and its panel markup name no place');
assert(/icon\.innerHTML = CESTISCore\.ui\.syncIcon\(h\.icon\)/.test(extractFunction(INDEX, 'refreshSyncChip')), 'its icon comes from the shared core (check or arrows)');
// The one attribute this preview added to the Connect button beside the chip
// (the button's own icon and words are the wording sweep's, not this preview's).
const connectBtn = /<button class="cloud-sync-btn" onclick="connectToGoogleDrive\(\)"([^>]*)>/.exec(topbar);
assert(connectBtn && /title="Connect this computer for syncing" aria-label="Connect this computer for syncing"/.test(connectBtn[1]) && !SOURCE_WORDS.test(connectBtn[1]),
  'the Connect button\'s tooltip and label name no place');
assert(!/<span class="sync-chip-dot"|\.sync-chip-dot/.test(INDEX), 'no leftover dot styles');
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
// Its own words (everything else on it comes from the shared core, checked
// above). Internal names — storage keys, the page-cloud's backend name, the
// browser's event names — are never shown, so they are set aside.
const INTERNAL = ['schoolDashboardGoogleAccessToken', 'schoolDashboardGoogleTokenExpiry', 'offline-server', 'offline', 'cestisLanTrouble'];
const chipLiterals = (CHIP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').match(/'(?:[^'\\]|\\.)*'/g) || []).map(s => s.slice(1, -1)).filter(s => INTERNAL.indexOf(s) === -1);
assert(chipLiterals.indexOf('Checking…') !== -1 && chipLiterals.every(s => !SOURCE_WORDS.test(s)), 'the sibling chip\'s own words name no place: ' + chipLiterals.filter(s => SOURCE_WORDS.test(s)).join(' | '));
assert(/C\.ui\.syncIcon\(h\.icon\)/.test(CHIP) && !/cestis-sync-chip-dot/.test(CHIP), 'the sibling chip shows the same icon (no bare dot)');

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
assert(!inp.connected && inp.pending && inp.pendingSince, 'not set up to sync and an edit since the page opened: waiting, with since when');
assert(Core.ui.syncHealth(inp).state === 'attention' && Core.ui.syncHealth(inp).tone === 'bad', '→ Sync needs attention — ask the office, red');
sb = sibling({ pages: [page({ cesti_virements: '2026-01-01T00:00:00.000Z' })] });
assert(!sb.CESTISSyncChip.inputs().pending, 'an edit from before the page was opened is not counted as this visit\'s');
const tok = { schoolDashboardGoogleAccessToken: 't', schoolDashboardGoogleTokenExpiry: new Date(Date.now() + 3600e3).toISOString() };
sb = sibling({ store: tok, pages: [page({ cesti_virements: later() }, { lastPush: new Date().toISOString() })] });
inp = sb.CESTISSyncChip.inputs();
assert(inp.connected && !inp.pending && Core.ui.syncHealth(inp).state === 'saved', 'set up to sync: each edit goes up within seconds — All saved');
const failing = page({}, { lastPush: '2026-10-22T10:00:00.000Z', error: 'http-500' });
sb = sibling({ store: tok, pages: [failing] });
inp = sb.CESTISSyncChip.inputs();
assert(inp.failures === 1 && inp.pending && Core.ui.syncHealth(inp).tone === 'bad', 'an upload that failed: Changes waiting to sync, red');
failing.state.lastPush = '2026-10-22T10:05:00.000Z';
inp = sb.CESTISSyncChip.inputs();
assert(inp.failures === 0 && !inp.pending, 'once a later upload goes through, the old error no longer counts (page-cloud leaves it set)');
sb = sibling({ online: false, store: tok, pages: [page({ cesti_virements: later() })] });
assert(Core.ui.syncHealth(sb.CESTISSyncChip.inputs()).state === 'offline', 'no connection: Not synced yet — your work is kept on this computer');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
