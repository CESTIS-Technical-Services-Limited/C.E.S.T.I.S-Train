/* A person's own profile changes are never undone — by an older copy, a
   default or a sign-out (CESTISCore.profiles, and the dashboard's use of it).

   The owner: "when account holders change profile picture, status etc, and
   any other thing to their personal profile, it should be added to their
   drive folder created by VocTrain and changes always show and not
   disappear when log out and log in back."

   What went wrong:
     - the device kept chat profiles WITHOUT their pictures, and profiles were
       merged WHOLE by updatedAt, which moves whenever the owner is seen
       online — so a device that had just seen its owner online held the
       newer copy, with no picture and an old status message, and the merge
       deleted the picture and put the old message back on every device;
     - presence wrote "online" / "offline" into the very field that held the
       status the person chose;
     - Edit Profile replaced the trainee's profile record whole (what else it
       held was dropped) and a trainee's sign-out kept it under the wrong key
       (the account id; it is filed under her student ID) — her phone and
       e-mail left the device with nothing else holding them when unsent;
     - a member of staff's phone never travelled (the account merge did not
       carry it) and the account was never dated, so the next sync put the
       old name and e-mail back;
     - a trainee at home (the trainee gate takes only her profile record) had
       her picture and status kept on her phone alone.

   Pinned here, with the real cestis-core.js and the real functions from
   index.html (in a vm):
     1. the detail rule: an edit stamped here beats an older copy dated later
        by presence; a detail one copy lacks is never a deletion; a picture
        taken off ('' with its stamp) stays off; presence by lastSeen;
        unstamped copies still settle on the newer record;
     2. pictures kept apart: stored, put back, never an older one over a newer
        one or over a removal;
     3. the Centre's network merges the same way (pageCloud);
     4. a trainee's own chat details inside her profile record: only a
        picture that is a picture, only a real status; her published records
        carry them (Core.gate sliceFor); the gate takes such a record;
     5. the dashboard: Edit Profile changes the record in place and stamps
        what changed; a trainee's sign-out keeps her own profile and chat
        profile; the account phone travels; a trainee's record never sets a
        member of staff's picture; the merges of every path use the rule.

   Run: node tests/profile-persistence.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const { makeCentre, NOW: FIX_NOW } = require('./gate-fixture');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
const ROOT = path.join(__dirname, '..');
const PAGES = [{ where: 'index.html', src: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') }];
if (fs.existsSync(path.join(ROOT, 'Offline System', 'index.html'))) PAGES.push({ where: 'Offline System/index.html', src: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8') });
function extractFunction(src, name) {
  const m = new RegExp('function ' + name + '\\(').exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
const P = Core.profiles;
const copy = v => JSON.parse(JSON.stringify(v));
const NOW = Date.now();
const iso = ms => new Date(ms).toISOString();
const PIC1 = 'data:image/jpeg;base64,' + Buffer.alloc(300, 1).toString('base64');
const PIC2 = 'data:image/jpeg;base64,' + Buffer.alloc(300, 2).toString('base64');
const CHAT = { name: 'chatProfiles' };

/* ---------------------------------------------------------------- 1 */
console.log('1. The detail rule');
{
  // Before: an old profile everyone holds.
  const base = { name: 'Tameka Richards', role: 'student', status: 'online', lastSeen: iso(NOW - 3600e3), statusMsg: 'Hello', updatedAt: iso(NOW - 3600e3) };
  // PC A: she changes her picture, status and message (30 minutes ago).
  const a = copy(base);
  a.profilePic = PIC1; a.statusMsg = 'In the workshop'; a.statusChoice = 'away';
  P.touch(a, ['profilePic', 'statusMsg', 'statusChoice'], iso(NOW - 1800e3), 'chatProfiles');
  assert(a._fs && a._fs.profilePic && a._fs.statusMsg && a._fs.statusChoice && a._fs._, 'the edit stamps each detail it changed, and the floor');
  assertEq(a.profileAt, a.updatedAt, 'and dates the profile (profileAt: presence never moves it)');
  // PC B: never saw the edit, keeps profiles without pictures, and has just seen her online.
  const b = copy(base); b.status = 'online'; b.lastSeen = iso(NOW); b.updatedAt = iso(NOW);
  const onB = copy(b); P.mergeRecord(onB, a, CHAT);
  assertEq([onB.profilePic === PIC1, onB.statusMsg, onB.statusChoice], [true, 'In the workshop', 'away'], 'PC B takes the edit although its own copy is dated later (presence)');
  assertEq([onB.status, onB.lastSeen], ['online', iso(NOW)], 'and keeps the later presence');
  const onA = copy(a); P.mergeRecord(onA, b, CHAT);
  assertEq([onA.profilePic === PIC1, onA.statusMsg, onA.statusChoice, onA.lastSeen], [true, 'In the workshop', 'away', iso(NOW)], 'PC A keeps its edit, takes the later presence');
  // The old rule, for the record: the presence-dated copy won whole.
  const old = copy(a); Core.sync.mergeMap({ x: old }, { x: b }, {});
  const oldMap = { x: copy(a) }; Core.sync.mergeMap(oldMap, { x: b }, {});
  assert(oldMap.x.profilePic === undefined && oldMap.x.statusMsg === 'Hello', '(the old whole-record merge deleted the picture and put the old message back)');
  // A copy simply without the picture never deletes it, either way round, stamps or not.
  const noPic = copy(a); delete noPic.profilePic; noPic.updatedAt = iso(NOW + 1000);
  const k1 = copy(a); P.mergeRecord(k1, noPic, CHAT);
  assertEq(k1.profilePic, PIC1, 'a newer copy lacking the picture does not delete it');
  const legacyL = { name: 'X', profilePic: PIC1, updatedAt: iso(NOW - 5000) }, legacyC = { name: 'X', statusMsg: 'new', updatedAt: iso(NOW) };
  P.mergeRecord(legacyL, legacyC, CHAT);
  assertEq([legacyL.profilePic === PIC1, legacyL.statusMsg], [true, 'new'], 'two unstamped copies: the newer adds, the missing deletes nothing');
  const legacy2 = { name: 'X', statusMsg: 'old', updatedAt: iso(NOW - 5000) };
  P.mergeRecord(legacy2, { name: 'X', statusMsg: 'newer', updatedAt: iso(NOW) }, CHAT);
  assertEq(legacy2.statusMsg, 'newer', 'two unstamped copies still settle on the newer record');
  // Taking the picture off is a dated removal that stays.
  const off = copy(a); off.profilePic = ''; P.touch(off, ['profilePic'], iso(NOW - 600e3), 'chatProfiles');
  const k2 = copy(a); P.mergeRecord(k2, off, CHAT); assertEq(k2.profilePic, '', 'a picture taken off later is taken off');
  const k3 = copy(off); P.mergeRecord(k3, a, CHAT); assertEq(k3.profilePic, '', 'and an older copy never puts it back');
  // Two people's edits of two details both stand; the same detail: the later.
  const x = copy(a), y = copy(a);
  x.bio = 'Welder'; P.touch(x, ['bio'], iso(NOW - 120e3), 'chatProfiles');
  y.statusMsg = 'Back at 2'; P.touch(y, ['statusMsg'], iso(NOW - 60e3), 'chatProfiles');
  const xy = copy(x); P.mergeRecord(xy, y, CHAT); const yx = copy(y); P.mergeRecord(yx, x, CHAT);
  assertEq([xy.bio, xy.statusMsg], ['Welder', 'Back at 2'], 'two devices, two details: both kept (one way)');
  assertEq([yx.bio, yx.statusMsg], ['Welder', 'Back at 2'], 'both kept (the other way)');
  // An edit never goes backwards.
  const fwd = copy(a); const before = Core.sync.fields.parse(fwd._fs.statusMsg).t;
  fwd.statusMsg = 'again'; P.touch(fwd, ['statusMsg'], iso(NOW - 3600e3 * 5), 'chatProfiles');
  assert(Core.sync.fields.parse(fwd._fs.statusMsg).t > before, 'a stamp is never earlier than the one it replaces (a slow clock)');
  // Status choice: presence never touches it.
  assertEq([P.chosenStatus({}), P.chosenStatus({ statusChoice: 'away', status: 'online' }), P.chosenStatus({ statusChoice: 'nonsense' })], ['online', 'away', 'online'], 'the chosen status is its own detail');
  // A whole map, with deletions honoured.
  const map = { u1: copy(b), u2: { name: 'Gone', updatedAt: iso(NOW - 9e6) } };
  const res = P.mergeMap(map, { u1: a, u3: { name: 'New' } }, { name: 'chatProfiles', tombs: { u2: iso(NOW - 1e6) } });
  assertEq([res.added, res.removed, map.u1.statusMsg, !!map.u3, !!map.u2], [1, 1, 'In the workshop', true, false], 'a map: added, merged by detail, a deleted one stays deleted');
  // A trainee profile: an office detail the trainee's copy never had stays.
  const office = { email: 'a@x', phone: '1', address: 'Kingston', updatedAt: iso(NOW - 100e3) };
  const hers = { email: 'a@x', phone: '2', updatedAt: iso(NOW - 50e3) };
  const sp = copy(office); P.mergeRecord(sp, hers, { name: 'studentProfiles' });
  assertEq([sp.phone, sp.address], ['2', 'Kingston'], 'her newer phone; the office\'s detail is kept');
}

/* ---------------------------------------------------------------- 2 */
console.log('2. Pictures kept apart');
{
  const r = { name: 'T', updatedAt: iso(NOW - 9000) };
  r.profilePic = PIC1; P.touch(r, ['profilePic'], iso(NOW - 8000), 'chatProfiles');
  const pics = P.picturesOf({ t: r });
  assert(pics.t && pics.t.pic === PIC1 && pics.t.fs === r._fs.profilePic && pics.t.at === iso(NOW - 8000), 'the picture with its own stamp and time');
  const stripped = P.stripPictures({ t: r });
  assert(stripped.t.profilePic === undefined && stripped.t._fs.profilePic, 'the profile list holds no picture bytes (its stamp stays)');
  stripped.t.lastSeen = iso(NOW); stripped.t.updatedAt = iso(NOW);
  assertEq(P.attachPictures(stripped, pics), 1, 'put back');
  assertEq(stripped.t.profilePic, PIC1, 'the same picture');
  // A newer picture is never replaced by an older kept one, nor a removal.
  const newer = copy(r); newer.profilePic = PIC2; P.touch(newer, ['profilePic'], iso(NOW - 4000), 'chatProfiles');
  const s2 = P.stripPictures({ t: newer }); s2.t.profilePic = PIC2;
  P.attachPictures(s2, pics);
  assertEq(s2.t.profilePic, PIC2, 'an older kept picture never replaces a newer one');
  const gone = copy(r); gone.profilePic = ''; P.touch(gone, ['profilePic'], iso(NOW - 4000), 'chatProfiles');
  const s3 = P.stripPictures({ t: gone });
  assertEq(s3.t.profilePic, '', 'a removal is kept in the list (it is a dated detail, not bytes)');
  P.attachPictures(s3, pics);
  assertEq(s3.t.profilePic, '', 'and an older kept picture never undoes it');
  // Two kept-picture maps: the later one; the same one is no change.
  const keep = { t: copy(pics.t) };
  assertEq(P.mergePictures(keep, { t: Object.assign({}, pics.t, { at: iso(NOW) }) }), 0, 'the same picture with the same stamp, dated later, is no change');
  assertEq(P.mergePictures(keep, P.picturesOf({ t: newer })), 1, 'a newer picture replaces the kept one');
  assertEq(P.mergePictures(keep, pics), 0, 'an older one does not');
  // An unstamped (old) picture is never newer than a dated one.
  const legacy = P.picturesOf({ t: { profilePic: PIC1, updatedAt: iso(NOW + 5000), lastSeen: iso(NOW + 5000) } });
  assert(Date.parse(legacy.t.at) < Date.parse(pics.t.at), 'a picture from before pictures were dated counts as old, never as new as presence');
}

/* ---------------------------------------------------------------- 3 */
console.log('3. The Centre\'s network merges the same way');
{
  const PC = Core.pageCloud;
  const a = { name: 'T', updatedAt: iso(NOW - 3600e3), lastSeen: iso(NOW - 3600e3), status: 'online' };
  const edited = copy(a); edited.statusMsg = 'Hi'; edited.statusChoice = 'away'; P.touch(edited, ['statusMsg', 'statusChoice'], iso(NOW - 1800e3), 'chatProfiles');
  const seen = copy(a); seen.lastSeen = iso(NOW); seen.updatedAt = iso(NOW);
  const out = JSON.parse(PC.mergeRecordValue('voctrain_chatProfiles', JSON.stringify(P.stripPictures({ t: seen })), JSON.stringify(P.stripPictures({ t: edited })), false));
  assertEq([out.t.statusMsg, out.t.statusChoice, out.t.lastSeen], ['Hi', 'away', iso(NOW)], 'voctrain_chatProfiles: the edit and the later presence');
  const sp = JSON.parse(PC.mergeRecordValue('voctrain_studentProfiles', JSON.stringify({ s: { phone: '1', address: 'K', updatedAt: iso(NOW - 9e5) } }), JSON.stringify({ s: { phone: '2', updatedAt: iso(NOW) } }), false, { students: {}, users: {}, centres: {}, sync: {} }));
  assertEq([sp.s.phone, sp.s.address], ['2', 'K'], 'voctrain_studentProfiles: detail by detail');
  const pics = JSON.parse(PC.mergeRecordValue('voctrain_chatPictures', JSON.stringify({ t: { pic: PIC1, at: iso(NOW - 9000) } }), JSON.stringify({ t: { pic: '', at: iso(NOW) }, u: { pic: PIC2, at: iso(NOW) } }), false));
  assertEq([pics.t.pic, pics.u.pic === PIC2], ['', true], 'voctrain_chatPictures: the later picture or removal of each person');
  assert(PC.isRecordKey('voctrain_chatPictures'), 'the kept pictures travel record by record (a trainee\'s device may send hers)');
}

/* ---------------------------------------------------------------- 4 */
console.log('4. A trainee\'s own chat details inside her profile record');
{
  const r = { name: 'K', role: 'student', status: 'online', lastSeen: iso(NOW), updatedAt: iso(NOW - 9e5) };
  r.profilePic = PIC1; r.statusChoice = 'away'; r.statusMsg = 'At home'; P.touch(r, ['profilePic', 'statusChoice', 'statusMsg'], iso(NOW - 6e5), 'chatProfiles');
  const part = P.chatPart(r);
  assertEq(Object.keys(part).sort(), ['_fs', 'profilePic', 'statusChoice', 'statusMsg', 'updatedAt'], 'only her own details and their stamps (no presence, no name)');
  const office = { name: 'K', role: 'student', status: 'offline', lastSeen: iso(NOW - 5000), updatedAt: iso(NOW - 5000), statusMsg: 'Old' };
  assert(P.takeChatPart(office, part), 'the office takes them');
  assertEq([office.profilePic === PIC1, office.statusChoice, office.statusMsg, office.status], [true, 'away', 'At home', 'offline'], 'her details, the office\'s own presence untouched');
  // Taken once: the same again is no change (a device that merges it at
  // every sync must not think it has something new to send each time).
  assert(!P.takeChatPart(office, part) && !P.takeChatPart(office, copy(part)), 'the same details again change nothing');
  const twice = { t: copy(office) };
  assertEq(P.mergeMap(twice, { t: copy(office) }, CHAT), { added: 0, updated: 0, removed: 0 }, 'the same profile merged again changes nothing');
  const st2 = P.stripPictures(twice); P.attachPictures(st2, P.picturesOf(twice));
  assertEq(P.attachPictures(st2, P.picturesOf(twice)), 0, 'nor does putting the same picture back again');
  const bad = { profilePic: 'javascript:alert(1)', statusChoice: 'admin', statusMsg: { x: 1 }, bio: 'ok', updatedAt: iso(NOW) };
  const tgt = {}; P.takeChatPart(tgt, bad);
  assertEq([tgt.profilePic, tgt.statusChoice, tgt.statusMsg, tgt.bio], [undefined, undefined, undefined, 'ok'], 'a "picture" that is not a picture, an unknown status and a non-text message are refused');
  // Her published records carry them (Core.gate sliceFor).
  const C = makeCentre(Core);
  const me = C.trainees[0];
  const st = Object.assign({}, C.asStrings);
  const rec = copy(r); delete rec.profilePic;
  st.voctrain_chatProfiles = JSON.stringify({ [me.acct.id]: rec, [C.trainees[1].acct.id]: { statusMsg: 'NOT-HERS', profileAt: iso(FIX_NOW) } });
  st.voctrain_chatPictures = JSON.stringify(P.picturesOf({ [me.acct.id]: r }));
  const built = Core.gate.buildAll(st, FIX_NOW, { builtBy: 'profile-test' });
  const sl = built.slices[me.acct.id].slice;
  const sps = sl.data.voctrain_studentProfiles;
  const carried = Object.keys(sps).map(k => sps[k]).find(x => x && x.preferences && x.preferences.chat);
  assert(carried && carried.preferences.chat.profilePic === PIC1 && carried.preferences.chat.statusChoice === 'away' && carried.preferences.chat.statusMsg === 'At home',
    'her published records carry her picture, status and message');
  assert(Date.parse(carried.updatedAt) >= Date.parse(carried.preferences.chat.updatedAt), 'dated no earlier than them (her phone takes the newer record)');
  assert(JSON.stringify(sl).indexOf('NOT-HERS') === -1, 'never somebody else\'s');
  assertEq(built.slices[me.acct.id].scrubbed, 0, 'nothing the privacy sweep had to take out');
  // The gate takes such a record from her (its fields are fixed by the gate).
  const item = { id: 'IT-1', kind: 'rec', key: 'voctrain_studentProfiles', recId: me.stu.id,
    rec: { email: 'k@x', phone: '876', updatedAt: iso(NOW), preferences: { chat: P.chatPart(r), gender: 'Male', genderAt: iso(NOW) } } };
  const v = Core.gate.validateItem(item, { acct: me.acct.id, stu: me.stu.id }, sl, {});
  assert(v.ok && v.rec.preferences && v.rec.preferences.chat && v.rec.preferences.chat.profilePic === PIC1 && v.rec.preferences.gender === 'Male', 'the gate takes her record with them, as it is (' + (v.reason || 'ok') + ')');
}

/* ---------------------------------------------------------------- 5 */
console.log('5. The dashboard');
PAGES.forEach(({ where: w, src }) => {
  // Edit Profile: in place, stamped.
  {
    const fields = { editProfileName: 'Alicia Grant', editProfileEmail: 'alicia@x.org', editProfilePhone: '876-555-0101', editProfileEmergencyName: 'Mum', editProfileEmergencyPhone: '876-555-0102', editProfileGender: 'Female' };
    const alicia = { id: 'STU-ali', name: 'Alicia Grant', course: 'Cosmetology', gender: '', lastModified: iso(NOW - 9e5) };
    const sb = { CESTISCore: Core, currentRole: 'student', currentStudent: alicia, currentLoggedInUser: { id: 'USR-ali', name: 'Alicia Grant' },
      students: [alicia], userAccounts: [{ id: 'USR-ali', name: 'Alicia Grant' }],
      studentProfiles: { 'STU-ali': { email: 'old@x.org', phone: '1', officeNote: 'kept', preferences: { chat: { statusMsg: 'from home' } }, updatedAt: iso(NOW - 9e5) } },
      window: {}, document: { getElementById: id => ({ value: fields[id] }) }, showToast() {}, addNotification() {},
      enrolPropagateToFee() {}, syncProfileToLmsChat() {}, saveState() {}, closeModal() {}, updateSidebarAvatar() {}, buildStudentPages() {}, showPage() {}, cestisGateSession: () => false };
    vm.createContext(sb);
    vm.runInContext(['profileNowIso', 'saveStudentProfile'].map(n => extractFunction(src, n)).join('\n') + '\nsaveStudentProfile();', sb);
    const p = sb.studentProfiles['STU-ali'];
    assertEq([p.phone, p.email, p.emergencyName, p.officeNote, p.preferences.chat.statusMsg], ['876-555-0101', 'alicia@x.org', 'Mum', 'kept', 'from home'], w + ': Edit Profile changes her record in place (what else it held stays)');
    assert(p._fs && p._fs.phone && p._fs.email && !p._fs.officeNote && Date.parse(p.updatedAt) > NOW - 60e3, w + ': each change stamped, the record dated');
    assert(alicia.gender === 'Female' && Date.parse(alicia.lastModified) > NOW - 60e3, w + ': a gender change dates her record, so it travels');
  }
  // The account's phone travels; the account is dated when its owner edits it.
  {
    const sb = { CESTISCore: Core, userAccounts: [{ id: 'USR-a', username: 'a', email: 'a@x', phone: '1', updatedAt: iso(NOW - 9e5), password: 'h1' }],
      isUserDeleted: () => false, console };
    vm.createContext(sb);
    vm.runInContext(extractFunction(src, 'mergeCloudAccounts'), sb);
    sb.mergeCloudAccounts([{ id: 'USR-a', username: 'a', email: 'a@x', phone: '876-555-0190', updatedAt: iso(NOW), password: 'h1' }]);
    assertEq(sb.userAccounts[0].phone, '876-555-0190', w + ': a newer account copy brings its phone number');
    const save = extractFunction(src, 'saveAccountProfile');
    assert(/saveUserAccounts\(\)/.test(save) && /updatedAt = _t/.test(save), w + ': a staff member\'s own edit dates the account and writes the accounts list at once');
    assert(/touchAccount\(acct\)/.test(extractFunction(src, 'saveInstructorProfile')), w + ': and an instructor\'s new name dates the account');
  }
  // A trainee's record sets only a trainee's chat profile.
  {
    const sb = { CESTISCore: Core, lmsChatProfiles: { 'USR-staff': { statusMsg: 'Staff', updatedAt: iso(NOW - 9e5) } },
      userAccounts: [{ id: 'USR-staff', role: 'admin' }, { id: 'USR-k', role: 'student', studentDataId: 'STU-k' }],
      studentProfiles: {
        'USR-staff': { preferences: { chat: { statusMsg: 'HACKED', updatedAt: iso(NOW) } } },
        'STU-k': { preferences: { chat: { statusMsg: 'Mine', profilePic: PIC1, statusChoice: 'away', updatedAt: iso(NOW) } } } },
      profileFolderWanted() {}, cestisGateSession: () => false, findStudentRecordForAccount: () => null };
    vm.createContext(sb);
    vm.runInContext(['profileTraineeAccountFor', 'profilesTakeTraineeChat', 'profileNowIso'].map(n => extractFunction(src, n)).join('\n'), sb);
    sb.profilesTakeTraineeChat();
    assertEq(sb.lmsChatProfiles['USR-staff'].statusMsg, 'Staff', w + ': a record under a staff account\'s key never changes their profile');
    assertEq([sb.lmsChatProfiles['USR-k'].statusMsg, sb.lmsChatProfiles['USR-k'].statusChoice, sb.lmsChatProfiles['USR-k'].profilePic === PIC1], ['Mine', 'away', true], w + ': her own chat details reach her chat profile');
  }
  // Sign-out keeps her own, the device keeps pictures, every path merges by the rule.
  {
    const clear = extractFunction(src, 'clearSensitiveStudentData');
    assert(/if\(studentId && studentProfiles\[studentId\]\) \{ myProfile\[studentId\] = studentProfiles\[studentId\]; \}/.test(clear), w + ': a trainee\'s sign-out keeps her profile, filed under her student ID');
    assert(/myChat\[userId\] = lmsChatProfiles\[userId\]/.test(clear) && /voctrain_chatPictures/.test(clear), w + ': and her own chat profile and picture');
    assert(/syncRebaselineAll\(\)/.test(clear), w + ': and what leaves the device is never taken for a deletion');
    assert(/CESTISCore\.profiles\.stripPictures\(lmsChatProfiles\)/.test(extractFunction(src, 'lmsChatStoreProfiles')) && /voctrain_chatPictures/.test(extractFunction(src, 'lmsChatStoreProfiles')), w + ': the device keeps the pictures apart, never drops them');
    assert(/lmsChatStoreProfiles\(\)/.test(extractFunction(src, 'saveLmsChatData')), w + ': every chat save keeps them');
    assert(/lmsChatAttachPictures\(\)/.test(extractFunction(src, 'initLmsChatData')) && !/lmsChatProfiles = JSON\.parse\(cp\)/.test(extractFunction(src, 'initLmsChatData')), w + ': reading the chat back merges and puts the pictures back (never replaces)');
    assert(/CESTISCore\.profiles\.mergeMap\(lmsChatProfiles, data\.chatProfiles/.test(extractFunction(src, 'lmsChatSyncFromDrive')), w + ': the chat file merges profiles by the rule');
    assert(/CESTISCore\.profiles\.mergeMap\(lmsChatProfiles, cp/.test(extractFunction(src, 'loadPerUserLocalData')), w + ': and so does this device\'s per-person copy (it used to be shut out by any profile already there)');
    assert(/profilesTakeTraineeChat\(\)/.test(extractFunction(src, 'mergeBackupData')), w + ': what a trainee sent from home reaches the chat profiles');
    const show = extractFunction(src, 'lmsChatOnPageShow'), beat = extractFunction(src, 'lmsChatHeartbeat');
    assert(/chosenStatus/.test(show) && !/\.status = 'online'/.test(show) && /chosenStatus/.test(beat), w + ': presence shows the chosen status, never writes "online" over it');
    assert(/loadOwnProfileFromFolder\(\)/.test(extractFunction(src, 'autoSyncOnLogin')), w + ': every sign-in reads the person\'s own folder');
    assert(/profile: true/.test(extractFunction(src, 'autoSaveToAllFolders')), w + ': and the 5-second save writes it');
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
