/* Two people changing DIFFERENT details of one trainee at the same time both
   keep their change.

   What happened (found in the multi-device stress audit): every computer
   merges the Centre's one backup on each pull, and a trainee record merged
   WHOLE — the copy with the newer lastModified won. The office changed a
   trainee's phone number on PC A; a few seconds later an instructor changed
   the same trainee's status on PC B. PC B's copy was newer, so on every
   computer the phone number went back to the old one, silently.

   Now each trainee record carries per-detail edit stamps (_fs, written by
   CESTISCore.sync.fields.stamp at every save, by difference with what was
   loaded, merged or last saved), and every merge of trainee records decides
   detail by detail where both copies say when that detail changed.

   Pinned here with the real cestis-core.js and the real functions from
   index.html (run in a vm, one context per computer):
     - stamping notices only the details that changed, never the stamps,
       dates, id or certificate state, never a record whose date did not move
       (a recalculated figure is not an edit), never a new record, keeps a
       stamp that arrived with its value, never goes backwards, and re-dates
       a stamp from a clock that was days fast;
     - two PCs editing different details: both kept, on both PCs, through the
       dashboard's backup merge (mergeCloudStudents), Core.mergeStudentRecords
       (sign-in merge, roll de-duplication) and the Centre's network merge
       (pageCloud 'voctrain_students');
     - the same detail on both: the newer edit wins;
     - neither copy stamped: EXACTLY the old result (checked against the old
       code, kept below, over many random records);
     - an older build that changed a detail without touching its stamp (or a
       detail with no stamp, under the record's floor): the stale stamp or
       floor is not believed and the old record-level rule decides;
     - a figure recalculated without re-dating the record is not stamped; it
       raises the floor to the record's date instead;
     - a record from an older build with no stamps at all: an edit stamped
       here wins only when it is newer than that record's own date;
     - a deleted trainee stays deleted;
     - a stamp more than a day in the future is not believed.

   Run: node tests/field-stamps-merge.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
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
const copy = (v) => JSON.parse(JSON.stringify(v));
const F = Core.sync.fields;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const stamped = (r) => Object.keys((r && r._fs) || {}).filter((k) => k !== F.FLOOR).sort();

/* One computer running the dashboard's own code. */
const PAGE_FNS = ['mergeCloudStudents', 'studentFieldsStamp', 'studentFieldsRebaseline'].map((n) => extractFunction(INDEX, n)).join('\n');
function pc(roll, deleted) {
  const ctx = {
    CESTISCore: Core, students: copy(roll), _studentFieldIndex: null, console,
    cestisIsStudentTombstoned: (s) => !!(deleted && deleted[s.id]),
    certMergeNumberAliases: (l, c) => Core.certs.mergeState(l, c)
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('var _studentFieldIndex = null;\n' + PAGE_FNS, ctx);
  vm.runInContext('studentFieldsRebaseline()', ctx);
  return {
    ctx,
    get roll() { return ctx.students; },
    rec(id) { return ctx.students.find((s) => s.id === id); },
    // An edit through any path that dates the record, then saveState's stamp.
    edit(id, patch, atMs) {
      const s = this.rec(id);
      Object.assign(s, patch);
      s.lastModified = iso(atMs);
      ctx.students = ctx.students;   // same array
      vm.runInContext('studentFieldsStamp(' + JSON.stringify(iso(atMs)) + ')', ctx);
    },
    pull(cloud) {
      ctx.__cloud = copy(cloud);
      vm.runInContext('studentFieldsStamp(); __changed = mergeCloudStudents(__cloud, {}); studentFieldsRebaseline();', ctx);
      return ctx.__changed;
    }
  };
}

const T0 = NOW - 60 * 60 * 1000;
const TRAINEE = { id: 'STU-ann', name: 'Ann Brown', course: 'WELDING L2', phone: '876-111-1111', status: 'active',
  email: 'ann@example.com', address: '1 Main St', notes: '', stage: 'training', progress: 40, lastModified: iso(T0) };

/* ---------------------------------------------------------------- stamping */
(function stamping() {
  const roll = [copy(TRAINEE), Object.assign(copy(TRAINEE), { id: 'STU-bob', name: 'Bob' })];
  let idx = Core.stampStudentFields(roll, null, '', true);
  assert(!roll[0]._fs && !roll[1]._fs, 'taking the baseline stamps nothing');

  // A detail changed and the record dated: only that detail is stamped.
  roll[0].phone = '876-222-2222';
  roll[0].lastModified = iso(NOW);
  idx = Core.stampStudentFields(roll, idx, iso(NOW));
  assertEq(stamped(roll[0]), ['phone'], 'only the changed detail carries a stamp');
  assert(F.stampFor(roll[0], 'phone', NOW) === NOW, 'the stamp is the moment of the save');
  assert(!roll[1]._fs, 'an untouched record is not stamped');

  // Dates, the stamps themselves, the id and the certificate state never are.
  roll[0].certNo = 'CERT-1'; roll[0].certNoAliases = ['X']; roll[0].lastModified = iso(NOW + 1000);
  idx = Core.stampStudentFields(roll, idx, iso(NOW + 1000));
  assertEq(stamped(roll[0]), ['phone'], 'certificate number, aliases and the date are not stamped');

  // A figure recalculated without dating the record is not an edit.
  roll[1].attendance = 87;
  idx = Core.stampStudentFields(roll, idx, iso(NOW + 2000));
  assert(!roll[1]._fs, 'a change on a record whose date did not move is not stamped');

  // A record new to this computer carries no stamps.
  roll.push(Object.assign(copy(TRAINEE), { id: 'STU-new', lastModified: iso(NOW + 3000) }));
  idx = Core.stampStudentFields(roll, idx, iso(NOW + 3000));
  assert(!roll[2]._fs, 'a new record is not stamped');

  // A detail that arrived with its own stamp keeps it.
  const theirs = F.format(NOW - 5000, F.valueHash('a@b.c'));
  roll[1].email = 'a@b.c'; roll[1]._fs = { email: theirs }; roll[1].lastModified = iso(NOW + 4000);
  idx = Core.stampStudentFields(roll, idx, iso(NOW + 4000));
  assertEq(roll[1]._fs.email, theirs, 'a stamp that arrived with its value is kept');

  // Removing a detail is an edit of it.
  roll[1].notes = 'x'; roll[1].lastModified = iso(NOW + 5000);
  idx = Core.stampStudentFields(roll, idx, iso(NOW + 5000));
  delete roll[1].notes; roll[1].lastModified = iso(NOW + 6000);
  idx = Core.stampStudentFields(roll, idx, iso(NOW + 6000));
  assert(F.stampFor(roll[1], 'notes', NOW) === NOW + 6000, 'a detail removed is stamped as removed');

  // Never backwards: a slow clock stamps after the stamp already there.
  roll[0].phone = '876-333-3333'; roll[0].lastModified = iso(NOW + 7000);
  idx = Core.stampStudentFields(roll, idx, iso(NOW - 10 * 60 * 1000));
  assert(F.stampFor(roll[0], 'phone', NOW) === NOW + 1, 'an edit on a slow clock is stamped just after the previous stamp');

  // A stamp from a clock days fast is re-dated to now on save.
  roll[2]._fs = { address: F.format(NOW + 5 * 86400000, F.valueHash(roll[2].address)) };
  idx = Core.stampStudentFields(roll, idx, iso(NOW + 8000));
  assert(F.stampFor(roll[2], 'address', NOW) === NOW + 8000, 'a stamp days in the future is re-dated on save');

  // Rebase never stamps.
  roll[1].gpa = '3.1'; roll[1].lastModified = iso(NOW + 9000);
  idx = Core.stampStudentFields(roll, idx, '', true);
  assert(!('gpa' in roll[1]._fs), 'taking the baseline afresh stamps nothing');
})();

/* ----------------------------------- two PCs, the dashboard's backup merge */
(function twoPcsDifferentDetails() {
  const A = pc([TRAINEE]), B = pc([TRAINEE]);
  A.edit('STU-ann', { phone: '876-999-0000' }, NOW - 3000);     // the office, PC A
  B.edit('STU-ann', { status: 'withdrawn' }, NOW - 1000);       // an instructor, PC B, 2 s later
  const aUp = copy(A.roll), bUp = copy(B.roll);
  B.pull(aUp);
  A.pull(bUp);
  [['PC A', A], ['PC B', B]].forEach(([name, P]) => {
    const r = P.rec('STU-ann');
    assertEq(r.phone, '876-999-0000', name + ' keeps the office\'s phone number');
    assertEq(r.status, 'withdrawn', name + ' keeps the instructor\'s status');
    assertEq(r.lastModified, iso(NOW - 1000), name + ' dates the record by the newer edit');
  });
  const sortedFs = (r) => JSON.stringify(Object.keys(r._fs).sort().map((k) => [k, r._fs[k]]));
  assertEq(sortedFs(A.rec('STU-ann')), sortedFs(B.rec('STU-ann')), 'both PCs hold the same stamps');
  assertEq(A.pull(copy(B.roll)), false, 'once both hold the same, pulling again changes nothing (no endless re-upload)');
  assertEq(B.pull(copy(A.roll)), false, '...on either PC');
  // The same stamps written in another order are the same record.
  const shuffled = copy(B.roll);
  const fsKeys = Object.keys(shuffled[0]._fs).reverse(), re = {};
  fsKeys.forEach((k) => { re[k] = shuffled[0]._fs[k]; });
  shuffled[0]._fs = re;
  A.pull(shuffled);
  assertEq(A.pull(copy(B.roll)), false, 'stamps are kept in one order, so a copy that wrote them in another settles at once');
  // And a third PC that still has the old copy takes both.
  const C = pc([TRAINEE]);
  C.pull(copy(A.roll));
  assertEq([C.rec('STU-ann').phone, C.rec('STU-ann').status], ['876-999-0000', 'withdrawn'], 'a third PC takes both changes');
  // The merge itself is not mistaken for an edit on the PC that pulled it.
  B.edit('STU-ann', { notes: 'called' }, NOW);
  assertEq(stamped(B.rec('STU-ann')), ['notes', 'phone', 'status'], 'what arrived kept its own stamp; only the new edit is stamped now');
  assert(F.stampFor(B.rec('STU-ann'), 'phone', NOW) === NOW - 3000, 'the phone keeps PC A\'s stamp');
})();

(function samDetailNewerWins() {
  const A = pc([TRAINEE]), B = pc([TRAINEE]);
  A.edit('STU-ann', { phone: '876-AAA' }, NOW - 1000);
  B.edit('STU-ann', { phone: '876-BBB', notes: 'n' }, NOW - 3000);  // B edited first
  const aUp = copy(A.roll), bUp = copy(B.roll);
  A.pull(bUp); B.pull(aUp);
  assertEq(A.rec('STU-ann').phone, '876-AAA', 'the same detail: the newer edit wins (PC A)');
  assertEq(B.rec('STU-ann').phone, '876-AAA', 'the same detail: the newer edit wins (PC B)');
  assertEq(A.rec('STU-ann').notes, 'n', 'the other detail B changed is kept');
  // Even when the losing edit's record is the newer one overall.
  const P = pc([TRAINEE]), Q = pc([TRAINEE]);
  P.edit('STU-ann', { phone: '1' }, NOW - 5000);
  Q.edit('STU-ann', { phone: '2' }, NOW - 6000);
  Q.edit('STU-ann', { address: '9 New Rd' }, NOW - 1000);           // Q's record is newer
  P.pull(copy(Q.roll));
  assertEq([P.rec('STU-ann').phone, P.rec('STU-ann').address], ['1', '9 New Rd'], 'the newer phone edit stands although the other record is newer');
})();

(function deletionStillWins() {
  const A = pc([TRAINEE]);
  A.edit('STU-ann', { phone: 'x' }, NOW - 1000);
  const B = pc([TRAINEE], { 'STU-ann': true });
  B.ctx.students = [];
  B.pull(copy(A.roll));
  assertEq(B.roll.length, 0, 'a deleted trainee is not brought back by a stamped copy');
})();

(function farFutureNotTrusted() {
  const A = pc([TRAINEE]);
  A.edit('STU-ann', { phone: 'mine' }, NOW - 1000);
  const cloud = copy(A.roll);
  // Another computer whose clock was a year ahead stamped its phone change.
  const r = cloud[0];
  r.phone = 'wrong-clock';
  r._fs = { phone: F.format(NOW + 365 * 86400000, F.valueHash('wrong-clock')) };
  r.lastModified = iso(NOW - 2000);
  A.pull(cloud);
  assertEq(A.rec('STU-ann').phone, 'mine', 'a stamp a year ahead is not believed: the newer record rule keeps this edit');
  assert(F.pick({ phone: 'a', _fs: { phone: F.format(NOW + 2 * 86400000, F.valueHash('a')) } }, { phone: 'b', lastModified: iso(NOW - 1) }, 'phone', { stamp: 'lastModified', nowMs: NOW }) === null,
    'pick: a stamp two days ahead decides nothing');
})();

/* ------------------------------------------------- mixed builds (old PCs) */
(function olderBuildChangedTheDetail() {
  // PC A (new) changes the phone; an OLD PC takes A's copy whole, changes the
  // phone itself later and carries A's stamp along untouched.
  const A = pc([TRAINEE]);
  A.edit('STU-ann', { phone: 'new-build' }, NOW - 5000);
  const oldPc = copy(A.roll);
  oldPc[0].phone = 'old-build-later';
  oldPc[0].lastModified = iso(NOW - 1000);
  A.pull(oldPc);
  assertEq(A.rec('STU-ann').phone, 'old-build-later', 'a stale stamp is not believed: the older build\'s later edit wins as it always did');
  assert(!F.stampFor(A.rec('STU-ann'), 'phone', NOW), 'and no stamp is left claiming the old value');
})();

(function olderBuildChangedAnUnstampedDetail() {
  // PC A (new) changes the status; an OLD PC takes that copy whole and later
  // changes the address, which carries no stamp — the floor A wrote no longer
  // describes the unstamped details, so it is not believed.
  const A = pc([TRAINEE]);
  A.edit('STU-ann', { status: 'paused' }, NOW - 6000);
  const oldPc = copy(A.roll);
  oldPc[0].address = 'old-build address';
  oldPc[0].lastModified = iso(NOW - 1000);
  assertEq(F.floorOf(oldPc[0], Core.STUDENT_FIELD_RULES, NOW), NOW - 1000, 'a floor the older build made stale falls back to the record date');
  const B = pc([TRAINEE]);
  B.edit('STU-ann', { address: 'new-build address' }, NOW - 3000);   // before the old PC's edit
  B.pull(oldPc);
  assertEq(B.rec('STU-ann').address, 'old-build address', 'the older build\'s later edit of an unstamped detail wins, as it always did');
  assertEq(B.rec('STU-ann').status, 'paused', 'and PC A\'s status travels with it');
})();

(function recalculatedFigureRaisesTheFloor() {
  const roll = [copy(TRAINEE)];
  let idx = Core.stampStudentFields(roll, null, '', true);
  roll[0].phone = 'p'; roll[0].lastModified = iso(NOW - 5000);
  idx = Core.stampStudentFields(roll, idx, iso(NOW - 5000));
  assertEq(F.floorOf(roll[0], Core.STUDENT_FIELD_RULES, NOW), T0, 'the floor starts at the record date before the first stamped edit');
  roll[0].attendance = 91;                                   // recalculated; the record is not re-dated
  idx = Core.stampStudentFields(roll, idx, iso(NOW));
  assertEq(stamped(roll[0]), ['phone'], 'a recalculated figure is not stamped');
  assertEq(F.floorOf(roll[0], Core.STUDENT_FIELD_RULES, NOW), NOW - 5000, '...it raises the floor to the record\'s date (what the old rule gave it)');
})();

(function wiredIntoEverySave() {
  const fnText = (src, name) => extractFunction(src, name);
  assert(/studentFieldsStamp\(now\)/.test(fnText(INDEX, 'syncStampAll')), 'every saveState() stamps the trainee details (syncStampAll)');
  assert(/studentFieldsRebaseline\(\)/.test(fnText(INDEX, 'syncRebaselineAll')), 'every load and backup merge takes the trainee baseline afresh (syncRebaselineAll)');
  assert(/studentFieldsStamp\(\)[\s\S]*mergeCloudStudents\(/.test(fnText(INDEX, 'mergeBackupData')), 'the backup merge stamps unsaved edits first, then merges detail by detail');
  assert(/studentFieldsRebaseline\(\)/.test(fnText(INDEX, 'cestisSettleRoster')), 'settling the roll is not taken for an edit');
  assert(/studentFieldsRebaseline\(\)/.test(fnText(INDEX, 'mergeFromCloud')), 'Merge Latest Changes takes the baseline before saving');
  const SP = fs.readFileSync(path.join(ROOT, 'Student-Progress.html'), 'utf8');
  assert(/spFieldsStamp\(\)/.test(fnText(SP, 'saveData')), 'Student Progress stamps the details it edits when it saves');
  assert(/spFieldsRebaseline\(\)/.test(fnText(SP, 'loadData')), 'Student Progress takes its baseline from what it reads');
})();

(function oldRecordWithoutStamps() {
  // An old PC's copy carries no _fs at all.
  const A = pc([TRAINEE]);
  A.edit('STU-ann', { phone: 'stamped-here' }, NOW - 1000);
  const oldNewer = [Object.assign(copy(TRAINEE), { status: 'graduated', lastModified: iso(NOW - 500) })];
  A.pull(oldNewer);
  // The old copy's record is newer than our stamp: it may have changed the
  // phone too, so the record-level rule decides — exactly as before.
  assertEq(A.rec('STU-ann').phone, TRAINEE.phone, 'an old copy dated after our stamp wins the detail (the old rule)');
  assertEq(A.rec('STU-ann').status, 'graduated', 'and its status');
  const B = pc([TRAINEE]);
  B.edit('STU-ann', { phone: 'stamped-here' }, NOW - 1000);
  const oldOlder = [Object.assign(copy(TRAINEE), { status: 'graduated', lastModified: iso(NOW - 2000) })];
  B.pull(oldOlder);
  assertEq(B.rec('STU-ann').phone, 'stamped-here', 'our stamped edit, newer than the old copy\'s date, stands');
  // An old copy that is older keeps its blank-filling only.
  const C = pc([TRAINEE]);
  C.edit('STU-ann', { status: 'paused' }, NOW - 500);
  C.pull([Object.assign(copy(TRAINEE), { status: 'graduated', lastModified: iso(NOW - 2000) })]);
  assertEq(C.rec('STU-ann').status, 'paused', 'a stamped edit newer than the whole old record stands');
})();

/* -------------- no stamps on either side: EXACTLY the old result (old code) */
// The dashboard's student merge as it was before the detail stamps.
function legacyDashboardMerge(students, cloudList, isDeleted) {
  let changed = false;
  cloudList.forEach((cloudStudent) => {
    if (!cloudStudent || typeof cloudStudent !== 'object') return;
    if (isDeleted(cloudStudent)) return;
    var localMatch = students.find(function(s) {
      if (s.id === cloudStudent.id) return true;
      return s.name && cloudStudent.name && s.name.trim().toLowerCase() === cloudStudent.name.trim().toLowerCase() &&
        s.course && cloudStudent.course && s.course.trim().toLowerCase() === cloudStudent.course.trim().toLowerCase();
    });
    if (localMatch) {
      var cloudMod = cloudStudent.lastModified ? new Date(cloudStudent.lastModified).getTime() : 0;
      var localMod = localMatch.lastModified ? new Date(localMatch.lastModified).getTime() : 0;
      var cloudIsNewer = cloudMod > localMod;
      if (Core.certs.mergeState(localMatch, cloudStudent)) changed = true;
      // (Widened with the merge itself: enrolStatus, gender, trn and nqs never reached a PC that already held the trainee.)
      var fieldsToMerge = ['stage','stageSetByUser','progress','name','course','instructor','certCollected','certNo','certDate','score','gpa','attendance','email','phone','status','address','dob','enrollDate','completionDate','nqfLevel','notes','enrolledAt','enrolStatus','gender','trn','nqs'];
      var _withdrawn = !!(Core.certs && Core.certs.isRevoked(localMatch));
      fieldsToMerge.forEach(function(field) {
        if (field === 'certNo' && localMatch.certNo) return;
        if (_withdrawn && (field === 'certNo' || field === 'certDate' || field === 'certCollected')) return;
        if (cloudStudent[field] !== undefined && cloudStudent[field] !== null && cloudStudent[field] !== '') {
          if (cloudIsNewer || !localMatch[field] || localMatch[field] === '') {
            if (localMatch[field] !== cloudStudent[field]) { localMatch[field] = cloudStudent[field]; changed = true; }
          }
        }
      });
      if (Array.isArray(cloudStudent.skills)) {
        if (!Array.isArray(localMatch.skills)) localMatch.skills = [];
        cloudStudent.skills.forEach(function(sk) { if (localMatch.skills.indexOf(sk) === -1) { localMatch.skills.push(sk); changed = true; } });
      }
      if (cloudIsNewer && cloudStudent.lastModified) localMatch.lastModified = cloudStudent.lastModified;
      try { if (Core.settleWithdrawnCertificate(localMatch)) changed = true; } catch (e) {}
    } else { students.push(cloudStudent); changed = true; }
  });
  return changed;
}
// Core.mergeStudentRecords as it was before the detail stamps.
const LEGACY_MERGE_FIELDS = ['stage', 'progress', 'score', 'gpa', 'certNo', 'certDate', 'certCollected', 'attendance', 'assignments', 'instructor',
  'email', 'phone', 'address', 'dob', 'enrollDate', 'completionDate', 'nqfLevel', 'notes', 'gender', 'schoolFeeId', 'source', 'keepSeparate', 'reEnrolledAt'];
function legacyMergeStudentRecords(a, b) {
  var aMod = a && a.lastModified ? new Date(a.lastModified).getTime() : 0;
  var bMod = b && b.lastModified ? new Date(b.lastModified).getTime() : 0;
  var base = (bMod > aMod) ? Object.assign({}, b) : Object.assign({}, a);
  var other = (bMod > aMod) ? a : b;
  LEGACY_MERGE_FIELDS.forEach(function (f) {
    if ((base[f] === undefined || base[f] === null || base[f] === '') && other[f] !== undefined && other[f] !== null && other[f] !== '') base[f] = other[f];
  });
  if (a && a.certNo) base.certNo = a.certNo;
  var norm = function (n) { return String(n == null ? '' : n).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  var aliases = [], seen = {};
  [a, b].forEach(function (r) {
    if (!r) return;
    (Array.isArray(r.certNoAliases) ? r.certNoAliases : []).concat(r.certNo ? [r.certNo] : []).forEach(function (n) {
      var k = norm(n);
      if (!k || k === norm(base.certNo) || seen[k]) return;
      seen[k] = true; aliases.push(String(n).trim());
    });
  });
  if (aliases.length) base.certNoAliases = aliases; else delete base.certNoAliases;
  if (Core.certs) Core.certs.mergeLifecycle(base, other || {});
  Core.settleWithdrawnCertificate(base);
  return base;
}
(function noStampsIsTheOldResult() {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pickOne = (arr) => arr[Math.floor(rnd() * arr.length)];
  const vals = { phone: ['', '1', '2', null], status: ['active', 'withdrawn', '', undefined], email: ['a@x', 'b@x', ''], stage: ['training', 'certified', 'nyc'],
    progress: [0, 40, 90], notes: ['', 'n1', 'n2'], gender: ['F', 'M', ''], enrolStatus: ['a', 'b', undefined], certNo: [undefined, 'C-1', 'C-2'],
    certDate: ['', 'June 1'], lastModified: [undefined, iso(T0), iso(T0 + 1000), iso(T0 + 2000)], skills: [undefined, ['a'], ['a', 'b']] };
  const make = () => { const r = { id: 'S1', name: 'Ann', course: 'WELD' }; Object.keys(vals).forEach((k) => { const v = pickOne(vals[k]); if (v !== undefined) r[k] = copy(v); }); return r; };
  let same = 0, sameRec = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const l = make(), c = make();
    // The dashboard's merge, on a PC with a baseline.
    const P = pc([l]);
    P.pull([c]);
    const legacyRoll = [copy(l)];
    legacyDashboardMerge(legacyRoll, [copy(c)], () => false);
    if (JSON.stringify(P.roll) === JSON.stringify(legacyRoll)) same++;
    else if (failed < 5) console.error('  dashboard differs:', JSON.stringify(l), JSON.stringify(c), JSON.stringify(P.roll), JSON.stringify(legacyRoll));
    // Core.mergeStudentRecords both ways round.
    if (JSON.stringify(Core.mergeStudentRecords(copy(l), copy(c))) === JSON.stringify(legacyMergeStudentRecords(copy(l), copy(c))) &&
        JSON.stringify(Core.mergeStudentRecords(copy(c), copy(l))) === JSON.stringify(legacyMergeStudentRecords(copy(c), copy(l)))) sameRec++;
  }
  assertEq(same, N, 'no stamps on either side: the dashboard merge gives exactly the old result (' + N + ' random pairs)');
  assertEq(sameRec, N, 'no stamps on either side: Core.mergeStudentRecords gives exactly the old result (' + N + ' random pairs)');
})();

/* ------------- the other merges of trainee records use the same rule */
(function coreMergeAndNetwork() {
  const base = copy(TRAINEE);
  // An edit made and saved on a computer running this build.
  const editOf = (rec, patch, at) => {
    const roll = [copy(rec)];
    const idx = Core.stampStudentFields(roll, null, '', true);
    Object.assign(roll[0], patch, { lastModified: iso(at) });
    Core.stampStudentFields(roll, idx, iso(at));
    return roll[0];
  };
  const a = editOf(base, { phone: 'A-phone' }, NOW - 3000);
  const b = editOf(base, { status: 'withdrawn' }, NOW - 1000);
  assertEq(F.floorOf(b, Core.STUDENT_FIELD_RULES, NOW), T0, 'the floor: b\'s unstamped details date from before its edit');
  // Hand-made stamps with no floor: an unstamped detail counts the record's
  // own date — the one-sided rule exactly as asked.
  const ha = Object.assign(copy(base), { phone: 'A-phone', lastModified: iso(NOW - 3000), _fs: { phone: F.format(NOW - 3000, F.valueHash('A-phone')) } });
  const hb = Object.assign(copy(base), { status: 'withdrawn', lastModified: iso(NOW - 1000), _fs: { status: F.format(NOW - 1000, F.valueHash('withdrawn')) } });
  assertEq(Core.mergeStudentRecords(copy(ha), copy(hb)).phone, TRAINEE.phone, 'with no floor, a one-sided stamp older than the other record keeps the old rule');
  const hc = Object.assign(copy(hb), { lastModified: iso(NOW - 4000) });
  assertEq(Core.mergeStudentRecords(copy(hc), copy(ha)).phone, 'A-phone', '...and one newer than the other record wins');
  [[a, b], [b, a]].forEach(([x, y], i) => {
    const m = Core.mergeStudentRecords(copy(x), copy(y));
    assertEq([m.phone, m.status, m.lastModified], ['A-phone', 'withdrawn', iso(NOW - 1000)], 'Core.mergeStudentRecords keeps both details (order ' + i + ')');
    assertEq(stamped(m), ['phone', 'status'], 'and both stamps (order ' + i + ')');
  });
  // The sign-in merge (Core.cloudMerge.applyStudent).
  const roll = [copy(a)];
  Core.cloudMerge.applyStudent(roll, copy(b), () => false);
  assertEq([roll[0].phone, roll[0].status], ['A-phone', 'withdrawn'], 'the sign-in merge keeps both details');
  assertEq(Core.cloudMerge.applyStudent([copy(a)], copy(b), () => true), 'skipped', 'and a deleted trainee is still skipped');
  // The Centre's network: the stored roll merged with the server's.
  const ctx = { students: {}, users: {}, centres: {}, sync: {}, studentsAt: {} };
  const out = JSON.parse(Core.pageCloud.mergeRecordValue('voctrain_students', JSON.stringify([a]), JSON.stringify([b]), false, ctx));
  assertEq([out[0].phone, out[0].status], ['A-phone', 'withdrawn'], 'the Centre\'s network merge keeps both details');
  const out2 = JSON.parse(Core.pageCloud.mergeRecordValue('voctrain_students', JSON.stringify([b]), JSON.stringify([a]), true, ctx));
  assertEq([out2[0].phone, out2[0].status], ['A-phone', 'withdrawn'], '...whichever side it runs on');
  const dead = { students: { 'STU-ann': true }, users: {}, centres: {}, sync: {}, studentsAt: {} };
  const gone = JSON.parse(Core.pageCloud.mergeRecordValue('voctrain_students', JSON.stringify([a]), JSON.stringify([b]), false, dead));
  assertEq(gone.length, 0, 'the network merge still drops a deleted trainee');
  // Details that belong together travel together: the stage and its marker.
  const s1 = editOf(base, { stage: 'certified', stageSetByUser: true, progress: 90 }, NOW - 3000);
  const s2 = editOf(base, { progress: 55 }, NOW - 1000);
  const ms = Core.mergeStudentRecords(copy(s1), copy(s2));
  assertEq([ms.stage, ms.progress], ['training', 55], 'the stage group is decided as one: the newer edit of any part of it wins the whole group');
  // A blank never replaces a detail the merge fills.
  const c1 = editOf(base, { phone: '' }, NOW - 1000);
  const c2 = Object.assign(copy(base), { lastModified: iso(NOW - 3000) });
  assertEq(Core.mergeStudentRecords(copy(c2), copy(c1)).phone, TRAINEE.phone, 'a blanked phone is filled back, as before');
})();

console.log('field-stamps-merge: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
