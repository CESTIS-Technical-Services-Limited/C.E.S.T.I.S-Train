/* The holes an adversarial review found in the integrated LMS, and the fixes.

   The Administrator's browser holds the Centre's Google Drive token, so any
   script that runs there can read or destroy every record. Each of these was
   shown in a real browser before it was fixed:

     H1  a chat room's icon, written by any device into the shared chat file,
         went straight into the chat header with innerHTML — markup in it ran in
         the Administrator's session the moment the room was opened;
     H2  the Document Hub drew a document's category, uploader and date (and
         put its file address into src="…" of the preview, the print window and
         the download link) as markup — the same;
     H3  MegaData-Admin.html (export every stored key, every password hash
         included) opened for anyone who typed its address;
     H4  School.Fee.html signed whoever opened it in as "CESTIS Administrator",
         and acted on a student list posted by any window; the finance pages
         beside it had no gate at all;
     H5  Payroll still opened as Administrator with the password published in
         this repository, and the Cashbook accepted the dashboard's seeded
         logins with it;
     M1  the idle lock left the dashboard's heartbeat beating, so a new tab
         opened the record pages with the locked person's session;
     M4  the certificate signing key was kept as a readable JWK, so any script
         in an admin session could carry it away;
     L1  a trainee's own phone number was drawn as markup on their profile;
     L2  the time clock's backup browser and merge summary drew file names,
         "saved by" and staff names as markup;
     L3  one poll with no options blanked a chat room for every member;
   plus two clean-ups: Core.html was defined twice, and a dead renderStudents
   wrote buttons for handlers that no longer exist.

   (M2/M3 — the offline server's token, names and class host places — are in
   Offline System/tests/offline-server-hardening.test.js and
   offline-signalling.test.js. The same holes are driven end to end in a real
   browser by tests/browser/security-regressions.js.)

   Run: node tests/review-security.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const Core = require('../cestis-core.js');
const SRC = read('index.html');

function extractFunction(src, name, where) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name.replace(/\$/g, '\\$') + '\\s*\\(').exec(src);
  if (!m) throw new Error((where || 'index.html') + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

/* What tags and attributes a browser would see in some markup. */
function parseTags(html) {
  const tags = [];
  const re = /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = [];
    const ar = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a;
    while ((a = ar.exec(m[2]))) attrs.push({ name: a[1].toLowerCase(), value: a[2] != null ? a[2] : (a[3] != null ? a[3] : (a[4] || '')) });
    tags.push({ name: m[1].toLowerCase(), attrs });
  }
  return tags;
}
const ATTACK = '<img src=x onerror=__pwn(1)>"><svg onload=__pwn(2)>" onmouseover="__pwn(3)';
const EVIL_URL = 'javascript:__pwn(4)//"><img src=x onerror=__pwn(5)>';
/* No tag or handler the function did not write itself, nothing carrying the
   attack's marker, and no script link. (Every payload calls __pwn.) */
function assertClean(html, label, fnSrc) {
  const legit = new Set((String(fnSrc || '').match(/\bon[a-z]+(?==)/g) || []));
  let bad = [];
  parseTags(String(html)).forEach(t => {
    if (t.name === 'script' || (t.name === 'img' && t.attrs.some(a => a.name === 'src' && a.value === 'x'))) bad.push('<' + t.name + '>');
    t.attrs.forEach(a => {
      // An escaped value may still READ as the attack (that is the point of
      // escaping); only a handler or a name made of it is code.
      if (a.name.indexOf('__pwn') !== -1 || (/^on/.test(a.name) && a.value.indexOf('__pwn') !== -1)) bad.push('<' + t.name + ' ' + a.name + '=__pwn…>');
      if (/^on/.test(a.name) && !legit.has(a.name)) bad.push(a.name + '=');
      if (/^(src|href)$/.test(a.name) && /^\s*javascript:/i.test(a.value)) bad.push(a.name + '=javascript:');
    });
  });
  assert(bad.length === 0, label + ': nothing was injected (found ' + bad.join(', ') + ')');
}

function makeEl(id) {
  const el = {
    id: id || '', _html: '', textContent: '', value: '', className: '', style: {}, dataset: {}, children: [],
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this.htmlWrites = (this.htmlWrites || 0) + 1; },
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle() {} },
    appendChild(c) { this.children.push(c); return c; }, removeChild() {}, insertAdjacentHTML(pos, h) { this._html += h; }, remove() {}, click() { this.clicked = true; },
    setAttribute() {}, getAttribute() { return null; }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, scrollIntoView() {}
  };
  return el;
}
function sandbox(extra) {
  const els = {};
  const body = makeEl('body');
  const doc = {
    getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
    createElement() { return makeEl(); }, querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, body
  };
  const sb = Object.assign({
    document: doc, console, JSON, Math, Date, Object, Array, String, Number, RegExp, Promise, Map, Set, Buffer,
    setTimeout(fn) { return 0; }, clearTimeout() {}, CESTISCore: Core, showToast() {}, __els: els
  }, extra || {});
  sb.window = sb;
  vm.createContext(sb);
  ['escapeHtml', 'escapeAttr', 'safeUrl', 'jsArg', 'lmsChatEscapeHtml'].forEach(n => vm.runInContext(extractFunction(SRC, n), sb));
  return sb;
}
function load(sb, src, names) { names.forEach(n => vm.runInContext(extractFunction(src, n), sb)); }

(async function main() {

// A section that throws (a function the page or the core no longer has, say)
// is a failure of that section, and the rest still run.
async function section(title, fn) {
  console.log(title);
  try { await fn(); } catch (e) { assert(false, title + ' — threw: ' + (e && e.message)); }
}

/* ===================================================================== H1 */
await section('H1 — a chat room\'s icon and colour are drawn as plain text and a real colour', async () => {
  const C = Core.chat;
  assertEq(C.roomIcon('💼'), '💼', 'an emoji icon is kept');
  assertEq(C.roomIcon('PL'), 'PL', 'a short plain icon is kept');
  assertEq(C.roomIcon(ATTACK), '💬', 'a markup "icon" becomes the chat bubble');
  assertEq(C.roomIcon('x'.repeat(40)), '💬', 'and so does a long one');
  assertEq(C.roomColor('#f0a500'), '#f0a500', 'a hex colour is kept');
  assertEq(C.roomColor('var(--accent)'), 'var(--accent)', 'a theme variable is kept');
  assertEq(C.roomColor('red;background:url(//evil.example/x)'), '#6c757d', 'a colour that tries to add CSS is replaced');
  assertEq(C.roomColor('#fff" onmouseover="__pwn()'), '#6c757d', 'and one that tries to end the attribute');
  const room = { id: 'R1', name: 'Study group', icon: ATTACK, color: 'x" onmouseover="y', members: ['A'] };
  assert(C.cleanRoom(room) === true && room.icon === '💬' && room.color === '#6c757d' && room.name === 'Study group',
    'cleanRoom fixes only the icon and colour, in place');
  const dm = { id: 'D1', type: 'dm', dmBetween: ['A', 'B'] };
  assert(C.cleanRoom(dm) === false && !('icon' in dm) && !('color' in dm), 'a room with no icon gains none (nothing added to records that did not need it)');
  assertEq(C.cleanRooms([{ icon: ATTACK }, { icon: '📚', color: '#09f' }]), 1, 'cleanRooms reports how many it changed');

  // The real chat header, opened by the Administrator on a room another device wrote.
  const evilRoom = { id: 'chat-grp-evil', name: 'Study group', icon: ATTACK, color: '#09f', type: 'group', members: ['USR-A'] };
  const sb = sandbox({
    lmsChatRooms: [evilRoom], lmsChatMessages: {}, lmsChatActiveRoom: null, lmsChatProfiles: {},
    lmsChatGetCurrentUser() { return { id: 'USR-A', name: 'Admin' }; }, saveLmsChatData() {}, lmsChatRenderMessages() {}, lmsChatRenderRoomList() {},
    lmsChatGetProfile() { return {}; }, lmsChatPresence() { return 'online'; }, lmsChatGetUserInitials() { return 'A'; },
    lmsChatOpenProfileCard() {}, lmsChatOpenMembersDirectory() {}, lmsChatRoomCourseEnded() { return false; }, userAccounts: []
  });
  load(sb, SRC, ['lmsChatRoomIcon', 'lmsChatRoomColor', 'lmsChatOpenRoom']);
  try { vm.runInContext('lmsChatOpenRoom("chat-grp-evil", "admin")', sb); } catch (e) { assert(false, 'lmsChatOpenRoom ran: ' + e.message); }
  const hdr = sb.__els.adminChatHeaderAvatar;
  assert(!!hdr, 'the header avatar was drawn');
  assert(hdr && hdr._html.indexOf('<img') === -1 && hdr._html.indexOf('onerror') === -1,
    'the room\'s icon never reaches the header as markup (it used to be innerHTML = room.icon) — got ' + JSON.stringify(hdr && hdr._html));
  assertEq(hdr && hdr.textContent, '💬', 'the header shows the safe icon as text');
  assert(hdr && !/onmouseover|url\(/.test(hdr.style.cssText || ''), 'and its colour cannot add CSS');

  // Rooms are cleaned where they come in, so every renderer is safe.
  const sync = extractFunction(SRC, 'lmsChatSyncFromDrive');
  assert(/mergeList\(lmsChatRooms, data\.chatRooms[^\n]*\n[\s\S]{0,400}lmsChatCleanRooms\(\)/.test(sync), 'the chat-file merge cleans the rooms it took in');
  assert(/mergeList\(lmsChatRooms, backupData\.data\.chatRooms[\s\S]{0,300}lmsChatCleanRooms\(\)/.test(SRC), 'so does the backup merge');
  assert(/lmsChatRooms = JSON\.parse\(cr\);\s*\n\s*lmsChatCleanRooms\(\)/.test(extractFunction(SRC, 'initLmsChatData')), 'and loading the rooms stored on this device');
  assert(!/room\.icon\b(?!\))/.test(SRC.replace(/room && room\.icon/g, '')), 'no renderer reads room.icon directly any more');
  const dir = extractFunction(SRC, 'lmsChatRenderMembersDirectory');
  assert(/escapeHtml\(lmsChatRoomIcon\(\{icon:icon\}\)\)/.test(dir) && /escapeAttr\(color \? lmsChatRoomColor/.test(dir),
    'the members directory draws a training centre\'s icon and colour safely too');
  assert(/escapeHtml\(sk\.icon\|\|'📋'\)/.test(SRC) && /escapeHtml\(sk\.icon \|\| '📋'\)/.test(SRC), 'and the training-centre tables');
});

/* ===================================================================== H2 */
await section('H2 — the Document Hub draws what another device wrote as text, and opens only real file links', async () => {
  const doc = { id: 'DOC-1', title: 'Timetable', description: 'x', category: ATTACK, uploadedBy: ATTACK, uploadedDate: ATTACK,
    audience: 'all', fileName: 'a.pdf', fileSize: 10, downloads: ATTACK, fileData: EVIL_URL };
  const base = { documentHubFiles: [doc], animateAllCounters() {} };
  const names = ['docHubFileUrl', 'docHubFormatFileSize', 'docHubGetFileIcon', 'renderDocumentHubAdmin', 'renderDocumentHubInstructor',
    'docHubPreviewFile', 'docHubPrintFile', 'docHubDownloadFile'];
  const fnSrc = names.map(n => extractFunction(SRC, n)).join('\n');

  let sb = sandbox(base); load(sb, SRC, names);
  sb.document.getElementById('DocHubCategoryFilter').value = 'all';
  vm.runInContext('renderDocumentHubAdmin("")', sb);
  const adminHtml = sb.__els.docHubAdminList._html;
  assert(adminHtml.indexOf('Timetable') !== -1, 'the administrator\'s list is drawn');
  assertClean(adminHtml, 'renderDocumentHubAdmin (category, uploaded by, date, downloads)', fnSrc);
  assertClean(sb.__els.docHubStats._html, 'its statistics cards (a text "downloads" used to run into data-count="…")', fnSrc);

  sb = sandbox(base); load(sb, SRC, names);
  sb.document.getElementById('iDocHubCategoryFilter').value = 'all';
  vm.runInContext('renderDocumentHubInstructor()', sb);
  assert(sb.__els.iDocHubList._html.indexOf('Timetable') !== -1, 'the instructor\'s list is drawn');
  assertClean(sb.__els.iDocHubList._html, 'renderDocumentHubInstructor', fnSrc);

  for (const fileName of ['a.pdf', 'a.png', 'a.' + 'zip"><svg onload=__pwn(9)>']) {
    sb = sandbox(Object.assign({}, base, { documentHubFiles: [Object.assign({}, doc, { fileName })] })); load(sb, SRC, names);
    vm.runInContext('docHubPreviewFile("DOC-1")', sb);
    const overlay = sb.document.body.children[0];
    assert(!!overlay, 'the preview opens for ' + fileName);
    assertClean(overlay ? overlay._html : '', 'docHubPreviewFile (' + fileName.slice(0, 8) + ')', fnSrc);
  }
  // Print: the window it opens is this site, so what is written there runs here.
  let written = '';
  sb = sandbox(Object.assign({}, base, { open() { return { document: { write(h) { written += h; }, close() {} }, close() {}, print() {} }; } }));
  load(sb, SRC, names);
  vm.runInContext('docHubPrintFile("DOC-1")', sb);
  assert(written.length > 0, 'the print window is written');
  assertClean(written, 'docHubPrintFile', 'onload');
  // Download: a javascript: "file" is not followed.
  sb = sandbox(base); load(sb, SRC, names);
  let link = null;
  sb.document.createElement = () => (link = makeEl());
  vm.runInContext('docHubDownloadFile("DOC-1")', sb);
  assert(!link || !/^\s*javascript:/i.test(String(link.href || '')), 'Download never follows a javascript: address');
  const good = Object.assign({}, doc, { fileData: 'data:application/pdf;base64,JVBERi0=' });
  sb = sandbox({ documentHubFiles: [good] }); load(sb, SRC, names);
  link = null; sb.document.createElement = () => (link = makeEl());
  vm.runInContext('docHubDownloadFile("DOC-1")', sb);
  assert(link && link.href === good.fileData && link.clicked, 'while a real stored file still downloads');
});

/* ===================================================================== L1 */
await section('L1 — a trainee\'s profile draws their own details as text', async () => {
  const f = extractFunction(SRC, 'buildStudentPages');
  assert(/id="sProfilePhone">\$\{escapeHtml\(/.test(f), 'the phone number is escaped');
  assert(!/\$\{s\.(id|attendance|enrolledDate|completionDate)\b/.test(f), 'and so are the id, attendance and dates around it');
});

/* ===================================================================== L2 */
await section('L2 — the time clock\'s backup browser and merge summary draw names as text', async () => {
for (const where of ['index.html', 'Staff.Clock.in.html']) {
  const src = read(where);
  const files = [{ id: 'F1"><svg onload=__pwn(1)>', name: ATTACK + '.json', savedBy: ATTACK, modifiedTime: new Date().toISOString(), hasValidFormat: true }];
  let sb = sandbox({ ttc_getTimeAgo() { return 'now'; }, getTimeAgo() { return 'now'; }, ttHost() { return sb.document.body; } });
  if (where !== 'index.html') load(sb, src, ['escapeHtml', 'escapeAttr']);
  load(sb, src, ['showFileBrowserModal']);
  sb.files = files;
  vm.runInContext('showFileBrowserModal(files)', sb);
  const fnSrc = extractFunction(src, 'showFileBrowserModal');
  assert(sb.document.body._html.indexOf('Browse Backup Files') !== -1, where + ': the backup browser is drawn');
  assertClean(sb.document.body._html, where + ': showFileBrowserModal (file name, id, saved by)', fnSrc);

  const evilStaff = { fullName: ATTACK, role: ATTACK }, evilRec = { staffName: ATTACK, date: ATTACK };
  const analysis = {
    staffMembers: { newLocal: [evilStaff], newCloud: [evilStaff], conflicts: [{ local: evilStaff, reasons: [ATTACK, 'b', 'c'] }] },
    timeRecords: { newLocal: [evilRec], newCloud: [evilRec], conflicts: [{ local: evilRec, reasons: [ATTACK] }] }
  };
  sb = sandbox({ staffMembers: [], timeRecords: [] });
  if (where !== 'index.html') load(sb, src, ['escapeHtml', 'escapeAttr']);
  load(sb, src, ['displayMergeAnalysis']);
  sb.analysis = analysis; sb.cloud = { timestamp: Date.now(), savedBy: ATTACK, data: { staffMembers: [], timeRecords: [] } };
  vm.runInContext('displayMergeAnalysis(analysis, cloud)', sb);
  const all = ['mergeSummary', 'cloudConflictsList', 'newRecordsList'].map(id => sb.__els[id]._html).join('\n');
  assert(all.indexOf('Potential Conflicts') !== -1, where + ': the merge summary is drawn');
  assertClean(all, where + ': displayMergeAnalysis (saved by, staff names, roles, reasons, dates)', extractFunction(src, 'displayMergeAnalysis'));
}
});

/* ===================================================================== L3 */
await section('L3 — one malformed poll no longer blanks a chat room', async () => {
  const sb = sandbox({ lmsChatActiveRoom: 'R1', lmsChatMessages: {}, lmsChatBlockedByCourseEnd() { return false; },
    lmsChatGetCurrentUser() { return { id: 'U1' }; }, saveLmsChatData() {}, lmsChatRenderMessages() {}, lmsChatGetRolePrefix() { return 'admin'; } });
  load(sb, SRC, ['lmsChatRenderPoll', 'lmsChatVotePoll']);
  const polls = [
    { id: 'P1', type: 'poll', pollQuestion: 'No options at all' },
    { id: 'P2', type: 'poll', pollQuestion: 'Options without votes', pollOptions: [{ text: 'a' }, null, { text: 'b', votes: 'U1' }] },
    { id: 'P3', type: 'poll', pollQuestion: 'Normal', pollOptions: [{ text: 'a', votes: ['U1'] }, { text: 'b', votes: [] }] }
  ];
  polls.forEach(p => {
    let html = null, err = null;
    try { html = vm.runInContext('lmsChatRenderPoll(' + JSON.stringify(p) + ', {id:"U1"})', sb); } catch (e) { err = e; }
    assert(!err && typeof html === 'string' && html.indexOf(p.pollQuestion) !== -1, p.pollQuestion + ': drawn, no TypeError' + (err ? ' — ' + err.message : ''));
  });
  assert(/100%/.test(vm.runInContext('lmsChatRenderPoll(' + JSON.stringify(polls[2]) + ', {id:"U1"})', sb)), 'a normal poll still shows its result');
  sb.lmsChatMessages.R1 = JSON.parse(JSON.stringify(polls.slice(0, 2)));
  let err = null;
  try { vm.runInContext('lmsChatVotePoll("P1", 0); lmsChatVotePoll("P2", 0); lmsChatVotePoll("P2", 1)', sb); } catch (e) { err = e; }
  assert(!err, 'voting on a malformed poll does not throw' + (err ? ' — ' + err.message : ''));
  assert(JSON.stringify(sb.lmsChatMessages.R1[1].pollOptions[0].votes) === '["U1"]', 'and a vote on an option with no list starts one');
});

/* ===================================================================== M1 */
await section('M1 — a locked dashboard lends its session to no new tab', async () => {
  const now = Date.now();
  const stored = {
    voctrain_sessionExpiry: String(now + 3600e3), voctrain_sessionRole: 'admin', voctrain_sessionUserId: 'USR-A',
    voctrain_sessionSeenAt: String(now), voctrain_users: JSON.stringify([{ id: 'USR-A', role: 'admin', status: 'active', password: 'h' }])
  };
  const store = { getItem: k => (k in stored ? stored[k] : null), setItem: (k, v) => { stored[k] = String(v); }, removeItem: k => { delete stored[k]; } };
  const viewer = () => Core.sessionAccess.resolve({ get: store.getItem, now: Date.now(), allowed: ['admin', 'adminstaff'] });
  const sb = sandbox({ CESTISStore: store, currentRole: 'admin', currentLoggedInUser: { id: 'USR-A', name: 'Admin', password: 'h' },
    userAccounts: [{ id: 'USR-A', password: 'h' }], openModal() {}, closeModal() {}, logout() {},
    verifyPassword: async (pw, h) => pw === 'right', _sessionLocked: false, _sessionLastActivity: now, _sessionWarned: false });
  vm.runInContext('var _sessionLocked = false, _sessionLastActivity = Date.now(), _sessionWarned = false;', sb);
  load(sb, SRC, ['sessionAccountRevoked', 'sessionHeartbeat', 'openIdleLock', 'idleLockUnlock']);
  assert(viewer().ok, 'with the dashboard open and unlocked, a new tab may open Student Progress');
  vm.runInContext('openIdleLock()', sb);
  assert(!('voctrain_sessionSeenAt' in stored), 'locking withdraws the heartbeat at once');
  assert(!viewer().ok, 'so a new tab opened while it is locked gets "sign in first" (it got the admin\'s session)');
  vm.runInContext('sessionHeartbeat()', sb);
  assert(!('voctrain_sessionSeenAt' in stored) && !viewer().ok, 'and the minute heartbeat stays silent while locked');
  sb.__els.idleLockPassword.value = 'wrong';
  await vm.runInContext('idleLockUnlock()', sb);
  assert(!viewer().ok, 'a wrong password does not bring it back');
  sb.__els.idleLockPassword.value = 'right';
  await vm.runInContext('idleLockUnlock()', sb);
  assert(viewer().ok, 'the owner\'s password unlocks it, and the record pages open again');
});

/* ============================================================ H3 / H4 core */
await section('H3/H4 — pages with no sign-in of their own open only for the signed-in dashboard', async () => {
  const SA = Core.sessionAccess;
  assert(typeof SA.guard === 'function' && typeof SA.lockPage === 'function', 'CESTISCore.sessionAccess.guard and lockPage exist');
  // guard() in a simulated page: no session, a trainee's session, an administrator's, embedded.
  function pageWith(stored, parent, ready) {
    const listeners = [];
    const store = { getItem: k => (k in stored ? stored[k] : null), isReady: () => ready, whenReady: cb => { if (ready) cb(); else listeners.push(cb); } };
    const win = { location: { search: '' }, parent: null };
    win.parent = parent || win;
    const g = { CESTISStore: store, window: win, URLSearchParams };
    return { g, fire: () => { ready = true; listeners.splice(0).forEach(f => f()); } };
  }
  const now = Date.now();
  const sess = role => ({ voctrain_sessionExpiry: String(now + 3600e3), voctrain_sessionSeenAt: String(now), voctrain_sessionRole: role,
    voctrain_sessionUserId: 'U-' + role, voctrain_users: JSON.stringify([{ id: 'U-' + role, role, status: 'active' }]) });
  // Run guard with the page's globals swapped in (forPage reads root.CESTISStore and window).
  function runGuard(pg, opts) {
    const saved = { s: global.CESTISStore, w: global.window };
    global.CESTISStore = pg.g.CESTISStore; global.window = pg.g.window;
    let got = null;
    try { SA.guard(opts, v => { got = v; }); } finally { global.CESTISStore = saved.s; global.window = saved.w; }
    return { get: () => got };
  }
  let r = runGuard(pageWith({}, null, true), { allowed: ['admin', 'adminstaff'] });
  assert(r.get() && !r.get().ok, 'no session: refused');
  r = runGuard(pageWith(sess('student'), null, true), { allowed: ['admin', 'adminstaff'] });
  assert(r.get() && !r.get().ok && r.get().reason === 'not-allowed', 'a trainee\'s live session: refused');
  r = runGuard(pageWith(sess('admin'), null, true), { allowed: ['admin', 'adminstaff'] });
  assert(r.get() && r.get().ok && r.get().role === 'admin', 'an administrator signed in on this computer: opens');
  const dash = { currentRole: 'adminstaff', currentLoggedInUser: { id: 'U-as' } };
  const inCashbook = { parent: dash };
  r = runGuard(pageWith({}, inCashbook, true), { allowed: ['admin', 'adminstaff'] });
  assert(r.get() && r.get().ok && r.get().role === 'adminstaff', 'embedded two frames down (dashboard → Cashbook → Virement): opens');
  r = runGuard(pageWith({}, null, true), { allowed: ['admin'], also: () => true });
  assert(r.get() && r.get().ok && r.get().reason === 'also', 'another sign-in the page accepts (a signed-in Cashbook) opens it');
  // A store still loading from IndexedDB is not a refusal yet.
  const pg = pageWith({}, null, false);
  r = runGuard(pg, { allowed: ['admin'] });
  assert(r.get() === null, 'with the store still loading, the answer waits');
  Object.assign(pg.g.CESTISStore, (() => { const s = sess('admin'); return { getItem: k => (k in s ? s[k] : null) }; })());
  const saved = { s: global.CESTISStore, w: global.window };
  global.CESTISStore = pg.g.CESTISStore; global.window = pg.g.window;
  try { pg.fire(); } finally { global.CESTISStore = saved.s; global.window = saved.w; }
  assert(r.get() && r.get().ok, 'and is given once it has loaded (an account kept only in IndexedDB)');

  // Each page asks before it draws anything.
  const PAGES = [
    ['MegaData-Admin.html', /SA\.guard\(\{ allowed: \['admin'\] \}/],
    ['MegaData-Adjudication.html', /SA\.guard\(\{ allowed: \['admin'\] \}/],
    ['School.Fee.html', /SA\.guard\(\{ allowed: \['admin', 'adminstaff'\] \}/],
    ['Virement.Request.html', /SA\.guard\(\{ allowed: \['admin', 'adminstaff'\], also: virInsideSignedInCashbook \}/],
    ['Income.Expenditure.html', /SA\.guard\(\{ allowed: \['admin', 'adminstaff'\] \}/],
    ['Payments.Invoices.html', /SA\.guard\(\{ allowed: \['admin', 'adminstaff'\] \}/],
    ['Finance.Invoice.html', /SA\.guard\(\{ allowed: \['admin', 'adminstaff'\] \}[\s\S]{0,200}FinanceDoc\.init\(/],
    ['Finance.Quote.html', /SA\.guard\(\{ allowed: \['admin', 'adminstaff'\] \}[\s\S]{0,200}FinanceDoc\.init\(/],
    ['Finance.Purchase.Order.html', /SA\.guard\(\{ allowed: \['admin', 'adminstaff'\] \}[\s\S]{0,200}FinanceDoc\.init\(/],
    ['Finance.Payment.Voucher.html', /SA\.guard\(\{ allowed: \['admin', 'adminstaff'\] \}[\s\S]{0,200}pvOpen\(\)/]
  ];
  PAGES.forEach(([f, re]) => assert(re.test(read(f)), f + ': opens only through CESTISCore.sessionAccess.guard'));
  const fee = read('School.Fee.html');
  assert(fee.indexOf("fullName: 'CESTIS Administrator'") === -1 || !/currentUser = \(Array\.isArray\(users\)[\s\S]{0,200}fullName: 'CESTIS Administrator'/.test(fee),
    'School.Fee no longer invents a "CESTIS Administrator" session');
  assert(!/const savedSession = sessionStorage\.getItem\('cestiCurrentUser'\)/.test(fee), 'nor believes whoever a previous visitor left in this tab');
  assert(/if \(!feeViewer \|\| window\.parent === window \|\| ev\.source !== window\.parent\) return;/.test(fee),
    'its message handler listens only to the dashboard that embeds it');
  const mda = read('MegaData-Admin.html');
  assert(/window\.__adminExportBuild = function \(\) \{\s*\n\s*if \(!ADMIN_OK\) throw/.test(mda), 'MegaData-Admin builds no export until an administrator is confirmed');
  // Qual-Plan: the address only narrows.
  const qp = read('Qual-Plan-Curriculum.html');
  const qpRoleSrc = /var qpRole = \(function \(\) \{[\s\S]*?\}\)\(\);/.exec(qp)[0];
  const qpRun = forPage => { const c = { CESTISCore: { sessionAccess: { forPage } } }; vm.createContext(c); vm.runInContext(qpRoleSrc, c); return c.qpRole; };
  assertEq(qpRun(() => ({ ok: false })), 'student', 'Qual-Plan opened by its address with ?role=admin and no session is a visitor\'s view (it defaulted to admin)');
  assertEq(qpRun(() => ({ ok: true, role: 'instructor' })), 'instructor', 'and otherwise the session\'s role');
});

/* ===================================================================== H5 */
await section('H5 — the published default password opens neither Payroll nor the Cashbook', async () => {
  const A = Core.accountAccess;
  const seed = { id: 'USR-001', role: 'admin', username: 'cestisadmin', password: 'cestisadmin123$', defaultPassword: true, status: 'active' };
  const real = { id: 'USR-r', role: 'admin', username: 'boss', password: 'pbkdf2$1$aa$bb', status: 'active' };
  let r = A.toolDefaultLogin({ otherRealAdmin: true, lmsAccounts: [] });
  assert(!r.allowed && !r.mustChange, 'another Payroll administrator with a real password: refused outright');
  r = A.toolDefaultLogin({ otherRealAdmin: false, lmsAccounts: [seed, real], lmsAdminSession: false });
  assert(!r.allowed && !r.mustChange && /sign in to the C\.E\.S\.T\.I\.S dashboard/i.test(r.message), 'the Centre has a real administrator but none is signed in here: refused (the lab-PC case)');
  r = A.toolDefaultLogin({ otherRealAdmin: false, lmsAccounts: [seed, real], lmsAdminSession: true });
  assert(!r.allowed && r.mustChange, 'an administrator signed in to the dashboard here: may set a new password (never locked out)');
  r = A.toolDefaultLogin({ otherRealAdmin: false, lmsAccounts: [seed] });
  assert(!r.allowed && r.mustChange, 'a brand-new installation: may set a new password (first run)');

  // The real Payroll sign-in gate, run against the real page code.
  const PS = read('Staff.Payslip.html');
  assert(/password:'cestisadmin123\$',\s*\n\s*defaultPassword:true,/.test(PS), 'Payroll\'s seed is marked as the seed');
  const subtle = globalThis.crypto.subtle;
  async function pbkdf2(pw) {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const k = await subtle.importKey('raw', new TextEncoder().encode(pw), { name: 'PBKDF2' }, false, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' }, k, 256);
    const hex = b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
    return 'pbkdf2$1000$' + hex(salt) + '$' + hex(bits);
  }
  async function payroll(payUsers, lmsUsers, lmsAdmin) {
    const stored = { dashboardUsers: JSON.stringify(payUsers), voctrain_users: JSON.stringify(lmsUsers) };
    const sb = sandbox({
      CESTISStore: { getItem: k => (k in stored ? stored[k] : null), setItem: (k, v) => { stored[k] = v; }, removeItem: k => { delete stored[k]; } },
      CESTISCore: { accountAccess: Core.accountAccess, sessionAccess: { forPage: () => ({ ok: !!lmsAdmin }) } },
      crypto: globalThis.crypto, TextEncoder, Uint8Array, parseInt, isCloudConnected: false, googleAccessToken: null,
      completed: null, alert() {}
    });
    sb.document.querySelector = sel => (sel === '#loginStepNewPassword .forgot-password-header'
      ? Object.assign(makeEl(), { querySelector: s => sb.document.getElementById('hdr-' + s) }) : null);
    vm.runInContext('var users = [], pendingResetUser = null, currentOTP = null, otpExpiry = null, PBKDF2_ITERATIONS = 1000;' +
      'const USERS_KEY = "dashboardUsers"; function getDefaultUsers(){ return []; } function autoSaveUsersToCloud(){}' +
      'function completeLogin(u){ completed = u; }', sb);
    load(sb, PS, ['_bufToHex', '_hexToBuf', '_pbkdf2Hex', 'hashPassword', 'isHashedPassword', 'verifyPassword', 'isAdminRole',
      'loadUsers', 'saveUsers', 'pyOtherRealAdmin', 'pyNewPwHeader', 'pyDefaultPasswordGate', 'showNewPasswordError', 'cancelForgotPassword', 'resetPassword']);
    vm.runInContext('pyForcedChange = false;', sb);
    return { sb, stored };
  }
  const seedPay = { id: 'admin_001', username: 'Cestisadmin', password: 'cestisadmin123$', defaultPassword: true, role: 'Administrator', isAdmin: true };
  const lmsReal = [{ id: 'USR-001', role: 'admin', username: 'cestisadmin', password: 'cestisadmin123$', defaultPassword: true, status: 'active' },
                   { id: 'USR-r', role: 'admin', username: 'boss', password: await pbkdf2('Boss-Pass-1'), status: 'active' }];

  // (a) the reviewer's case: a real LMS administrator exists, nobody is signed in to the dashboard here.
  let P = await payroll([seedPay], lmsReal, false);
  let go = await vm.runInContext('pyDefaultPasswordGate(loadUsers()[0], "cestisadmin123$")', P.sb);
  assert(go === false, 'Payroll refuses the published default on a lab PC where the dashboard has a real administrator (it opened as Administrator)');
  assert(/C\.E\.S\.T\.I\.S dashboard/.test(P.sb.document.getElementById('loginErrorText').textContent) && P.sb.document.getElementById('loginStepNewPassword').style.display !== 'block',
    'it says why, and offers no "set a new password" to the visitor');
  // (b) an administrator signed in to the dashboard on this computer: first-run change, then in.
  P = await payroll([seedPay], lmsReal, true);
  go = await vm.runInContext('pyDefaultPasswordGate(loadUsers()[0], "cestisadmin123$")', P.sb);
  assert(go === false && P.sb.document.getElementById('loginStepNewPassword').style.display === 'block', 'with an administrator signed in here, the default leads only to "set a new password"');
  P.sb.document.getElementById('newPassword').value = P.sb.document.getElementById('confirmNewPassword').value = 'cestisadmin123$';
  await vm.runInContext('resetPassword()', P.sb);
  assert(!P.sb.completed, 'the published default cannot be chosen as the new password');
  P.sb.document.getElementById('newPassword').value = P.sb.document.getElementById('confirmNewPassword').value = 'Payroll-Own-1';
  await vm.runInContext('resetPassword()', P.sb);
  const after = JSON.parse(P.stored.dashboardUsers)[0];
  assert(P.sb.completed && P.sb.completed.username === 'Cestisadmin', 'after a password of its own, the administrator is in');
  assert(/^pbkdf2\$/.test(after.password) && after.defaultPassword === undefined, 'stored hashed, and no longer marked as the seed');
  assert(await vm.runInContext('pyDefaultPasswordGate(loadUsers()[0], "Payroll-Own-1")', P.sb) === true, 'and its own password signs in as before');
  // (c) another Payroll administrator with a real password: refused outright.
  P = await payroll([seedPay, { id: 'pay2', username: 'bursar', password: await pbkdf2('Bursar-Pass-1'), role: 'Administrator' }], [], true);
  go = await vm.runInContext('pyDefaultPasswordGate(loadUsers()[0], "cestisadmin123$")', P.sb);
  assert(go === false && /another administrator/i.test(P.sb.document.getElementById('loginErrorText').textContent), 'with another real Payroll administrator, the default is refused outright');
  // (d) a brand-new installation (no LMS administrator yet): first run still works.
  P = await payroll([seedPay], [lmsReal[0]], false);
  go = await vm.runInContext('pyDefaultPasswordGate(loadUsers()[0], "cestisadmin123$")', P.sb);
  assert(go === false && P.sb.document.getElementById('loginStepNewPassword').style.display === 'block', 'a brand-new installation still has its first-run path (no lock-out)');

  // The Cashbook, against the dashboard's own accounts.
  const CB = read('CESTIS.Cashbook.html');
  async function cashbook(list) {
    const sb = sandbox({ CESTISStore: { getItem: k => (k === 'voctrain_users' ? JSON.stringify(list) : null) },
      crypto: globalThis.crypto, TextEncoder, Uint8Array, parseInt });
    vm.runInContext('const CB_LOGIN_ROLES = ["admin", "adminstaff"];', sb);
    load(sb, CB, ['cbHex', 'cbVerifyPassword', 'cbFindLoginAccount']);
    return sb;
  }
  const boss = { id: 'USR-r', role: 'admin', username: 'boss', password: await pbkdf2('Boss-Pass-1'), status: 'active' };
  const seeds = [{ id: 'USR-001', role: 'admin', username: 'cestisadmin', password: await pbkdf2('cestisadmin123$'), defaultPassword: true, status: 'active' },
                 { id: 'USR-011', role: 'adminstaff', username: 'adminstaff', password: 'cestisadmin123$', status: 'active' },
                 { id: 'USR-off', role: 'admin', username: 'gone', password: await pbkdf2('Gone-Pass-1'), status: 'disabled' }];
  const cb = await cashbook([boss].concat(seeds));
  const res1 = await vm.runInContext('cbFindLoginAccount("cestisadmin", "cestisadmin123$")', cb);
  assert(res1 && res1.seed === true && !res1.username, 'the seeded administrator with the published default does not open the Cashbook (it did)');
  const res2 = await vm.runInContext('cbFindLoginAccount("adminstaff", "cestisadmin123$")', cb);
  assert(res2 && res2.seed === true && !res2.username, 'nor the seeded Admin Staff login');
  assert(!(await vm.runInContext('cbFindLoginAccount("gone", "Gone-Pass-1")', cb)), 'nor a switched-off administrator');
  const res3 = await vm.runInContext('cbFindLoginAccount("boss", "Boss-Pass-1")', cb);
  assert(res3 && res3.username === 'boss', 'while a real administrator signs in with their own password');
  assert(/acct && acct\.seed/.test(CB), 'and the refusal explains where to set a password');
});

/* ===================================================================== M4 */
await section('M4 — the certificate signing key is kept locked: it signs, it cannot be read out', async () => {
  const S = Core.certs.sig;
  const key = await S.generateKey('test');
  const locked = await S.lockKey(key.privateJwk);
  assert(S.isLockedKey(locked) && locked.extractable === false, 'lockKey gives a non-extractable private key');
  let exported = true;
  try { await globalThis.crypto.subtle.exportKey('jwk', locked); } catch (e) { exported = false; }
  assert(!exported, 'whose bytes cannot be exported by any script');
  assert(await S.checkKey(locked, key.publicJwk), 'checkKey proves it signs for its own public key');
  const other = await S.generateKey('other');
  assert(!(await S.checkKey(locked, other.publicJwk)), 'and refuses a mismatched pair (a JWK copy is never given up for a key that does not work)');
  const f = { no: 'WE-2026-0001', name: 'A Trainee', programme: 'Welding', date: '2026-10-01' };
  const rec = await S.sign({ kid: key.kid, privateKey: locked }, f);
  assertEq((await S.verify(rec, { keys: [{ kid: key.kid, publicJwk: key.publicJwk }] })).result, 'valid', 'a certificate signed with the locked key verifies');
  const rec2 = await S.sign(key, f);
  assertEq((await S.verify(rec2, { keys: [{ kid: key.kid, publicJwk: key.publicJwk }] })).result, 'valid', 'a key stored the old way still signs (nothing breaks before migration)');
  // The page: the stored JWK is migrated to a locked key, and dropped only after the one backup.
  const load_ = extractFunction(SRC, 'certSigningKeyLoad');
  assert(/S\.lockKey\(key\.privateJwk\)[\s\S]*S\.checkKey\(locked, key\.publicJwk\)[\s\S]*if \(!ok\) return key;[\s\S]*key\.privateKey = locked;/.test(load_),
    'loading a stored key adds its locked copy, checked to sign first');
  const lockStored = extractFunction(SRC, 'certSigningLockStored');
  assert(/checkKey\(pk, key\.publicJwk\)[\s\S]*if \(!ok\) return false;[\s\S]*privateKey: pk, backedUpAt/.test(lockStored) && !/privateJwk/.test(lockStored.split('var rec =')[1] || ''),
    'after the backup, the record keeps only the locked key — and only once it is proven to sign');
  const restore = extractFunction(SRC, 'certSigningImportBackup');
  assert(/lockKey\(/.test(restore) && !/privateJwk: \{ kty/.test(restore), 'a restored key is stored locked, not as a JWK');
  const create = extractFunction(SRC, 'certSigningCreateKey');
  assert(/lockKey\(key\.privateJwk\)/.test(create), 'a new key is stored with its locked copy from the start');
  // A locked key signs from the page's own flow.
  const sb = sandbox({ students: [{ id: 'S1', certNo: 'WE-2026-0001', name: 'A Trainee', course: 'Welding', certDate: '2026-10-01', stage: 'certified' }],
    certDownloadApprovals: [{ studentId: 'S1', approved: true }], saveState() {}, renderCertDownloadMgmt() {},
    certSignedFields: s => S.fields(s, 'Welding'), certSigningKeyLoad: () => Promise.resolve({ kid: key.kid, publicJwk: key.publicJwk, privateKey: locked }) });
  load(sb, SRC, ['certSignApproved']);
  const n = await vm.runInContext('certSignApproved({ quiet: true })', sb);
  assert(n === 1 && sb.students[0].certSig && sb.students[0].certSig.kid === key.kid, 'the page signs approved certificates with the locked key');
});

/* ============================================================ clean-ups */
await section('Integration clean-ups', async () => {
  const core = read('cestis-core.js');
  assertEq((core.match(/Core\.html = \(function/g) || []).length, 1, 'Core.html is defined once (it was defined twice, byte for byte)');
  assert(!/function renderStudents\(/.test(SRC) && !/renderStudents\(/.test(SRC), 'the dead renderStudents (a table that no longer exists, buttons for removed handlers) is gone');
  const pkg = JSON.parse(read('package.json'));
  assert(/tests\/megadata-bat-lint\.test\.js/.test(pkg.scripts.test), 'megadata-bat-lint runs with npm test');
  assert(/review-security\.test\.js/.test(pkg.scripts.test), 'and so does this test');
  assert(/transcripts-admin\.js/.test(pkg.scripts['test:browser:transcripts'] || ''), 'the transcripts browser test has an npm script');
  assert(/security-regressions\.js/.test(pkg.scripts['test:browser:security'] || ''), 'and so does the security browser test');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
