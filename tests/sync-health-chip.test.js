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
assert(r.state === 'offline' && r.label === 'Not synced yet — your work is kept on this computer' && r.tone === 'warn', 'no connection with unsent work: Not synced yet — your work is kept on this computer (amber: offline is not a fault)');
assert(/sync by themselves/.test(r.advice.join(' ')) && /ask the office/.test(r.advice.join(' ')) && /Do not clear this browser/.test(r.advice.join(' ')),
  'and what to do (keep working; ask the office if it stays; do not clear the browser)');
r = S({ online: false });
assert(r.state === 'offline' && r.tone === 'warn', 'cannot sync with nothing waiting is amber, not red');
r = S({ connected: false, pending: true, pendingSince: NOW - 25 * 60000 });
assert(r.state === 'attention' && r.label === 'Sync needs attention — ask the office' && r.tone === 'warn', 'not set up to sync, with unsent work: Sync needs attention — ask the office (amber)');
assert(/kept on this computer only/.test(r.detail) && /ask the office/i.test(r.advice[0]), 'saying the work is only here, and who sets it up');
r = S({ connected: false });
assert(r.state === 'attention' && r.tone === 'warn', 'not set up to sync, nothing waiting: amber');
r = S({ connected: false, signinExpired: true, pending: true });
assert(r.state === 'attention' && r.tone === 'bad' && /sign-in on this computer has expired/.test(r.detail), 'a sync sign-in that has run out: red, and it says so');
assert(S({ connected: false, failures: 2 }).tone === 'bad', 'saves failing while not connected: red');
assert(/^Ask the office to set up syncing/.test(S({ connected: false }).advice[0]), 'with no Turn On Sync button beside it, the advice is to ask the office');
assert(/^Press Turn On Sync below, or ask the office/.test(S({ connected: false, canConnect: true }).advice[0]), 'with the button in the panel, it names it');
assert(/^Press Turn On Sync below to sign in again/.test(S({ connected: false, canConnect: true, signinExpired: true }).advice[0]), 'and, when the sign-in ran out, says to sign in again');

console.log('A trainee\'s or board member\'s device: not being connected is normal');
// Their devices are not signed in for syncing; the chip used to show them
// the same red "Sync needs attention" as an administrator whose sign-in ran out.
[{ connected: false }, { connected: false, pending: true, failures: 3 }, { online: false }, { connected: false, signinExpired: true }, { lan: true, lanTrouble: true }].forEach(o => {
  r = S(Object.assign({ staff: false }, o));
  assert(r.state === 'saved' && r.tone === 'ok' && r.label === 'All saved' && r.icon === 'check' && r.advice.length === 0 && r.lastSaved === '',
    'nothing of their own waiting (' + JSON.stringify(o) + '): All saved, calm, with a check');
});
r = S({ staff: false, connected: false, ownPending: true });
assert(r.state === 'waiting' && r.tone === 'warn' && r.chip === 'Waiting to send' && /kept on this computer/.test(r.detail), 'their own result still to send: Waiting to send, amber');
[{ online: false }, { failures: 4 }, { signinExpired: true }].forEach(o => assert(S(Object.assign({ staff: false, ownPending: true, connected: false }, o)).tone === 'warn', 'never red for them (' + JSON.stringify(o) + ')'));
[S({ staff: false }), S({ staff: false, ownPending: true })].forEach(o => {
  const words = [o.label, o.detail, o.lastSaved].concat(o.advice).join(' ');
  assert(!/cloud|☁|google|\bdrive\b|gmail|server|network|\blan\b|offline|internet|emailjs|peerjs|broker|megadata/i.test(words), 'their words name no place: ' + o.label);
});

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
console.log('The dashboard has ONE sync control: the answer, and (for staff) the sync actions in its panel');
const topbar = INDEX.slice(INDEX.indexOf('<header class="topbar">'), INDEX.indexOf('</header>', INDEX.indexOf('<header class="topbar">')));
assert(/<button type="button" class="sync-chip[^"]*" id="syncChip" onclick="toggleSyncChipPanel\(event\)" aria-expanded="false" aria-controls="syncChipPanel" aria-haspopup="dialog">/.test(topbar), 'a real button that says it opens a panel');
assert(/id="syncChipPanel" role="dialog"[^>]*hidden/.test(topbar), 'the panel is a labelled dialog, closed at first');
const panelStart = topbar.indexOf('id="syncChipPanel"');
const panelEnd = topbar.indexOf('<!-- End Cloud Sync -->');
const panelHtml = topbar.slice(panelStart, panelEnd);
const outside = topbar.slice(0, panelStart) + topbar.slice(panelEnd);
// The old second sync button (its own 🔄 icon and "Not synced yet"/"Sync ▼")
// sat beside the chip: two sync icons side by side. Its actions now live in
// the chip's panel; nothing in the bar outside the panel is a sync button.
assert(!/class="cloud-sync-btn/.test(outside) && !/🔄/.test(outside) && !/toggleCloudMenu\(\)|connectToGoogleDrive\(\)/.test(outside), 'no second sync button or sync icon in the bar');
assert(/id="cloudNotConnected"/.test(panelHtml) && /id="cloudConnected"/.test(panelHtml) && /id="cloudDropdownMenu"/.test(panelHtml), 'the sync actions (and the ids the sync code drives) are inside the panel');
['saveToCloud()', 'syncFromCloud()', 'mergeFromCloud()', 'browseBackupFiles()', 'restoreFromMasterBackup()', 'syncAllUserLoginFoldersToDrive()', 'disconnectFromGoogleDrive()', 'connectToGoogleDrive()'].forEach(fn =>
  assert(new RegExp('<button type="button" class="[^"]*" onclick="closeSyncChipPanel\\(\\); ' + fn.replace(/[()]/g, '\\$&') + '"').test(panelHtml), fn + ' is a button in the panel that closes it first'));
assert(/>Turn On Sync</.test(panelHtml) && />Send My Changes</.test(panelHtml) && />Get Latest Changes</.test(panelHtml), 'in the neutral words (Turn On Sync, Send My Changes, Get Latest Changes)');
assert(/function toggleCloudMenu\(\) \{\s*toggleSyncChipPanel\(\);\s*\}/.test(INDEX), '"open the sync menu" opens that one panel');
assert(/\.sync-panel-actions \{ display:none;/.test(INDEX) && /\.sync-chip-wrap\.staff \.sync-panel-actions \{ display:block; \}/.test(INDEX), 'the actions show for staff only');
assert(/wrap\.classList\.toggle\('staff', !!inp\.staff\)/.test(extractFunction(INDEX, 'refreshSyncChip')), 'and the control is marked staff from the signed-in role');
assert(/SYNC_STAFF_ROLES = \{ admin: 1, adminstaff: 1, instructor: 1 \}/.test(INDEX), 'staff: administrators, admin staff and instructors');
assert(/_syncChipSyncing = !!syncing; refreshSyncChip\(\)/.test(extractFunction(INDEX, 'setCloudSyncing')) && /is-syncing/.test(extractFunction(INDEX, 'refreshSyncChip')), 'a sync in progress turns the control\'s arrows ("Syncing…")');
const chipHtml = topbar.slice(topbar.indexOf('<div class="sync-chip-wrap"'), panelEnd).replace(/<!--[\s\S]*?-->/g, '');
assert(/<span class="sync-chip-icon" id="syncChipIcon" aria-hidden="true"><\/span>/.test(chipHtml) && !/sync-chip-dot/.test(chipHtml), 'the chip carries an icon slot (no bare dot)');
assert(chipHtml.length > 200 && !SOURCE_WORDS.test(chipHtml.replace(/<[^>]*>/g, ' ')), 'the words of the control and its panel name no place (its class names and ids are code)');
assert(/icon\.innerHTML = CESTISCore\.ui\.syncIcon\(h\.icon\)/.test(extractFunction(INDEX, 'refreshSyncChip')), 'its icon comes from the shared core (check or arrows)');
assert(!/<span class="sync-chip-dot"|\.sync-chip-dot/.test(INDEX), 'no leftover dot styles');
['syncChipInputs', 'refreshSyncChip', 'toggleSyncChipPanel'].forEach(fn => {
  const body = extractFunction(INDEX, fn);
  assert(!/setItem\(|removeItem\(|saveState\(|autoSaveToAllFolders|saveToCloud|syncFromCloud|mergeFromCloud|saveNow\(|loadNow\(/.test(body), fn + '() writes nothing and starts no sync');
});
assert(/var inp = syncChipInputs\(\);\s*var h = CESTISCore\.ui\.syncHealth\(inp\);/.test(extractFunction(INDEX, 'refreshSyncChip')), 'the words come from the shared rule');
assert(/typeof CESTISCore\.ui\.syncHealth !== 'function'/.test(extractFunction(INDEX, 'refreshSyncChip')), 'and a cached older cestis-core.js only hides the chip');
const inputs = extractFunction(INDEX, 'syncChipInputs');
['cestisPendingUpload', '_consecutiveCloudSaveFailures', 'schoolDashboardGoogleTokenExpiry', 'isCloudConnected', 'navigator.onLine', 'CESTISPageCloud.status()', 'SYNC_STAFF_ROLES[currentRole]', 'examOutboxRead()'].forEach(k =>
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
// The page's own sync elements it takes into its panel are found by their
// ids, and its stylesheet and selectors are code too.
const INTERNAL = ['schoolDashboardGoogleAccessToken', 'schoolDashboardGoogleTokenExpiry', 'offline-server', 'offline', 'cestisLanTrouble',
  'cloudSyncContainer', 'cloudNotConnected', 'cloudConnected'];
const isCode = s => /[{}]/.test(s) || /^[#.]|^(button|html)\b|, ?\./.test(s);
const chipLiterals = (CHIP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').match(/'(?:[^'\\]|\\.)*'/g) || []).map(s => s.slice(1, -1)).filter(s => INTERNAL.indexOf(s) === -1 && !isCode(s));
assert(chipLiterals.indexOf('Checking…') !== -1 && chipLiterals.indexOf(' Turn On Sync') !== -1 && chipLiterals.every(s => !SOURCE_WORDS.test(s)), 'the sibling chip\'s own words name no place: ' + chipLiterals.filter(s => SOURCE_WORDS.test(s)).join(' | '));
console.log('On a sibling page the chip is the one sync control: the page\'s own one moves into its panel');
assert(/function absorb\(c\)/.test(CHIP) && /getElementById\('cloudSyncContainer'\)/.test(CHIP) && /getElementById\('cloudNotConnected'\), doc\.getElementById\('cloudConnected'\)/.test(CHIP) && /getElementById\('syncBtn'\)/.test(CHIP),
  'it takes the page\'s Turn On Sync / sync menu (and Income & Expenditure\'s Sync Now)');
assert(/box\.appendChild\(p\)/.test(CHIP) && !/cloneNode|innerHTML\s*=\s*[^;]*cloud/.test(CHIP), 'by moving the elements themselves (ids and handlers kept), not copies');
assert(/\.cestis-sync-actions \.cloud-dropdown-content\{display:block!important;position:static!important/.test(CHIP) && /\.cestis-sync-actions \.cloud-dropdown>\.cloud-sync-btn\{display:none!important\}/.test(CHIP) || /\.cloud-dropdown>\.cloud-sync-btn\{display:none!important\}/.test(CHIP),
  'its menu shows as a list in the panel; the menu\'s own toggle button is gone');
assert(/html\.cestis-sync-chip-on #cloudStatus,html\.cestis-sync-chip-on \.cloud-status-bar\{display:none!important\}/.test(CHIP), 'the page\'s own status line gives way to the chip');
assert(/html\[data-theme="light"\] \.cestis-sync-chip\{/.test(CHIP) && /html\[data-theme="light"\] \.cestis-sync-chip-panel\{/.test(CHIP), 'and the chip and its panel follow Light mode');
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
assert(Core.ui.syncHealth(inp).state === 'attention' && Core.ui.syncHealth(inp).tone === 'warn', '→ Sync needs attention — ask the office, amber (not set up is not a fault)');
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
