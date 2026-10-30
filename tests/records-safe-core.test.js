/* Keeping the records safe for years — the pure rules (CESTISCore.backups),
   both builds. Owner approved, group F; the operations audit's OPS-1, OPS-2,
   OPS-4, OPS-10 and EF-6.

   Pinned here:
     1. the ISO week and the weekly file's name ("CESTIS-backup-2026-W44.json");
     2. what is kept and what goes to the trash: only this system's weekly
        files (the name's pattern AND its mark), one per week (the oldest),
        the newest 12 weeks; a week later than this computer's own is kept;
        a file of any other name, or with no mark, is never touched;
     3. "this week's is made already": any file with this week's name;
     4. the Administrator's "Last backup" line, and its prompt from 7 days;
     5. storage: used and free, the warning from 80%, "full"; and which
        refusals mean "out of room" (never a rate limit);
     6. each staff computer's last save: stamped, merged newest-wins per
        computer, listed newest first, silent after 7 days;
     7. the System health card: one line per concern, green/amber/red, each
        with what to do; the trainee sign-in bell;
     8. the weekly restore's preview counts;
     9. no line names where anything is kept (the owner's rule).

   Run: node tests/records-safe-core.test.js */
'use strict';
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
const BUILDS = [['main', require('../cestis-core.js')], ['Offline System', require(path.join('..', 'Offline System', 'cestis-core.js'))]];
const DAY = 86400000;
const FORBIDDEN = /\b(google|drive|cloud|server|gmail|internet|network)\b/i;

for (const [w, C] of BUILDS) {
  const B = C.backups;
  console.log('Weekly backups: names and weeks (' + w + ')');
  assert(B && typeof B.planPrune === 'function', w + ': CESTISCore.backups is there');
  if (!B) continue;
  eq(B.isoWeek(new Date(2026, 9, 30, 12)).label, '2026-W44', w + ': Fri 30 Oct 2026 is week 44');
  eq(B.isoWeek(new Date(2026, 9, 26, 0, 1)).label, '2026-W44', w + ': Monday starts the week');
  eq(B.isoWeek(new Date(2026, 9, 25, 23, 59)).label, '2026-W43', w + ': Sunday ends the one before');
  eq(B.isoWeek(new Date(2027, 0, 1, 12)).label, '2026-W53', w + ': 1 Jan 2027 is still 2026\'s week 53');
  eq(B.isoWeek(new Date(2027, 0, 4, 12)).label, '2027-W01', w + ': and 4 Jan 2027 is 2027\'s week 1');
  eq(B.fileName('2026-W44'), 'CESTIS-backup-2026-W44.json', w + ': the file is named by its week');
  eq(B.parseName('CESTIS-backup-2026-W44.json'), { year: 2026, week: 44, label: '2026-W44' }, w + ': and read back');
  eq([B.parseName('CESTIS-backup-2026-W44.json.bak'), B.parseName('my notes.json'), B.parseName('CESTIS-backup-2026-44.json')], [null, null, null], w + ': no other name is one of ours');

  console.log('What is kept, and what goes to the trash (' + w + ')');
  const now = new Date(2026, 9, 30, 12).getTime();
  const mark = { cestisBackup: 'weekly' };
  const wk = n => { const d = new Date(now - n * 7 * DAY); return B.isoWeek(d).label; };
  let files = [];
  for (let i = 0; i < 16; i++) files.push({ id: 'f' + i, name: B.fileName(wk(i)), createdTime: new Date(now - i * 7 * DAY).toISOString(), appProperties: mark });
  files.push({ id: 'dup', name: B.fileName(wk(0)), createdTime: new Date(now + 60000).toISOString(), appProperties: mark });     // a second PC, same week
  files.push({ id: 'hand', name: B.fileName(wk(20)), createdTime: new Date(now - 140 * DAY).toISOString() });                   // no mark: someone's own copy
  files.push({ id: 'other', name: 'Notes for the owner.json', createdTime: new Date(now - 300 * DAY).toISOString(), appProperties: mark });
  files.push({ id: 'future', name: B.fileName('2027-W10'), createdTime: new Date(now).toISOString(), appProperties: mark });
  files.push({ id: 'binned', name: B.fileName(wk(30)), createdTime: new Date(now - 210 * DAY).toISOString(), appProperties: mark, trashed: true });
  let plan = B.planPrune(files, now);
  const ids = l => l.map(f => f.id).sort();
  eq(plan.keep.length, 13, w + ': twelve weeks, and the week a wrong clock wrote, are kept');
  eq(ids(plan.trash), ['dup', 'f12', 'f13', 'f14', 'f15'].sort(), w + ': the four oldest weeks and the duplicate go to the trash');
  assert(plan.keep.some(f => f.id === 'f0') && !plan.keep.some(f => f.id === 'dup'), w + ': of two copies of this week, the older stays');
  assert(!plan.trash.some(f => ['hand', 'other', 'future', 'binned'].indexOf(f.id) !== -1), w + ': a file without the mark, of another name, from a later week, or already in the trash is never touched');
  eq(B.planPrune(files.slice(0, 5), now).trash, [], w + ': five weeks: nothing goes');
  eq(B.planPrune(files, now, 3).keep.length, 4, w + ': keep can be set (3 weeks + the later one)');
  eq(B.KEEP_WEEKS, 12, w + ': 12 weeks by default');
  assert(B.weekDone(files, wk(0)) && !B.weekDone(files, '2026-W45'), w + ': this week\'s is made already; next week\'s is not');
  assert(B.weekDone([{ id: 'x', name: B.fileName('2026-W45') }], '2026-W45'), w + ': a name collision counts as done, mark or not');
  eq(B.newest(files), { week: '2027-W10', at: now, id: 'future', name: B.fileName('2027-W10') }, w + ': the newest is by week');
  eq(B.newest(files.filter(f => f.id !== 'future')).id, 'f0', w + ': of this week\'s two copies, the older');
  eq(B.newest([{ id: 'hand', name: B.fileName('2026-W44'), createdTime: 'x' }]), null, w + ': a file without the mark is not a backup this system made');

  console.log('"Last backup" and its prompt (' + w + ')');
  let s = B.lastStatus({ week: '2026-W44', at: now - 2 * DAY }, now, true);
  assert(s.tone === 'ok' && /^Last backup: Wed 28 Oct 2026 \(2 days ago\)$/.test(s.text) && !s.prompt, w + ': 2 days: green, no prompt — "' + s.text + '"');
  s = B.lastStatus({ week: '2026-W43', at: now - 7 * DAY }, now, true);
  assert(s.tone === 'warn' && /\(7 days ago\)/.test(s.text) && /^No backup for 7 days\. Sign in on an office computer and let it save/.test(s.prompt), w + ': 7 days: amber, with the prompt — "' + s.prompt + '"');
  s = B.lastStatus({ week: '2026-W40', at: now - 30 * DAY }, now, true);
  assert(s.tone === 'bad' && s.days === 30, w + ': 30 days: red');
  assert(B.lastStatus(null, now, true).text === 'Last backup: none yet' && B.lastStatus(null, now, true).prompt, w + ': none yet, with the prompt');
  assert(/not checked/.test(B.lastStatus(null, now, false).text), w + ': not looked yet on this computer');
  eq(B.lastStatus({ at: now - 3600000 }, now, true).text, 'Last backup: Fri 30 Oct 2026 (today)', w + ': today');

  console.log('Storage (' + w + ')');
  const G = 1073741824;
  let q = B.storage({ limit: String(15 * G), usage: String(6 * G), usageInDriveTrash: '0' });
  assert(q.tone === 'ok' && q.pct === 40 && /^Storage: 6\.00 GB used of 15\.0 GB \(9\.00 GB free, 40% full\)$/.test(q.text) && !q.advice, w + ': 40%: green — "' + q.text + '"');
  q = B.storage({ limit: 15 * G, usage: 12 * G, usageInDriveTrash: 1.5 * G });
  assert(q.tone === 'warn' && /80% full/.test(q.text) && /1\.50 GB of it in the trash/.test(q.text) && q.advice === 'Storage is 80% full. Clear out old class recordings, or empty the trash.', w + ': 80%: the warning, and what to do — "' + q.advice + '"');
  q = B.storage({ limit: 15 * G, usage: 14.5 * G });
  assert(q.tone === 'bad' && /almost full/.test(q.advice), w + ': 97%: red');
  q = B.storage({ limit: 15 * G, usage: 3 * G }, true);
  assert(q.tone === 'bad' && /^Storage is full/.test(q.text) && /Clear out old class recordings, or empty the trash/.test(q.advice), w + ': a save refused for want of room: red, whatever the figure says');
  assert(B.storage(null).tone === 'warn' && /not checked/.test(B.storage(null).text), w + ': not checked yet');
  const refusal = { error: { code: 403, message: "The user's Drive storage quota has been exceeded.", errors: [{ domain: 'usageLimits', reason: 'storageQuotaExceeded', message: "The user's Drive storage quota has been exceeded." }] } };
  assert(B.quotaExceeded(refusal) && B.quotaExceeded(JSON.stringify(refusal)), w + ': "storageQuotaExceeded" is a full account (object or text)');
  assert(!B.quotaExceeded({ error: { code: 403, message: 'User Rate Limit Exceeded', errors: [{ reason: 'userRateLimitExceeded' }] } }), w + ': a rate limit is not');
  assert(!B.quotaExceeded({ error: { code: 403, message: 'The user does not have sufficient permissions for this file.', errors: [{ reason: 'insufficientFilePermissions' }] } }), w + ': nor a permission refusal');
  assert(!B.quotaExceeded(null) && !B.quotaExceeded('not json'), w + ': nor nothing');

  console.log('The last exported copy (' + w + ')');
  assert(B.exportStatus(null, now).tone === 'warn' && /USB/.test(B.exportStatus(null, now).todo), w + ': never: amber, with what to do');
  assert(B.exportStatus(now - 10 * DAY, now).tone === 'ok', w + ': 10 days: green');
  assert(B.exportStatus(now - 31 * DAY, now).tone === 'warn' && /More than 30 days ago/.test(B.exportStatus(now - 31 * DAY, now).todo), w + ': 31 days: the health card says so');

  console.log('Each staff computer\'s last save (' + w + ')');
  assert(B.deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36') === 'Windows · Chrome', w + ': Windows · Chrome');
  assert(B.deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15') === 'Mac · Safari', w + ': Mac · Safari');
  let map = B.stampDevice({}, 'pc-a', { by: 'mthompson', name: 'Marcia Thompson', role: 'admin', label: 'Windows · Chrome' }, now - 3600000);
  map = B.stampDevice(map, 'pc-b', { by: 'dbrown', name: 'Donovan Brown', role: 'adminstaff', label: 'Windows · Edge' }, now - 9 * DAY);
  const other = B.stampDevice({}, 'pc-b', { by: 'dbrown', name: 'Donovan Brown', role: 'adminstaff' }, now - 10 * DAY);
  let mg = B.mergeDevices(map, other);
  assert(!mg.changed && mg.map['pc-b'].at === new Date(now - 9 * DAY).toISOString(), w + ': an older save of the same computer does not win');
  mg = B.mergeDevices(other, map);
  assert(mg.changed && mg.map['pc-b'].at === new Date(now - 9 * DAY).toISOString() && mg.map['pc-a'], w + ': a newer one does; a computer not seen before is added');
  const list = B.devices(mg.map, now);
  assert(list.length === 2 && list[0].name === 'Marcia Thompson' && list[0].ago === '1 hour ago' && !list[0].silent, w + ': newest first, how long ago');
  assert(list[1].silent && list[1].ago === '9 days ago', w + ': silent after 7 days');
  let big = {};
  for (let i = 0; i < 70; i++) big = B.stampDevice(big, 'pc' + i, { by: 'u' + i }, now - i * 60000);
  assert(Object.keys(big).length === 60 && big.pc0 && !big.pc69, w + ': the newest 60 computers are kept (a cleared browser is a new one)');

  console.log('The System health card (' + w + ')');
  const good = {
    now, weekly: { checked: true, last: { week: '2026-W44', at: now - DAY } },
    master: { savedAt: now - 2 * 3600000, savedBy: 'mthompson', students: 214, records: 3402 },
    gate: { setUp: true, enabled: true, statusTone: 'ok', statusText: 'Ready — version 3 · 214 trainee accounts', waiting: 0, syncedAt: now - 120000, judged: true },
    storage: { limit: 15 * G, usage: 5 * G }, storageFull: false,
    devices: B.stampDevice({}, 'pc-a', { by: 'mthompson', name: 'Marcia Thompson', role: 'admin', label: 'Windows · Chrome' }, now - 60000),
    lastExport: now - 5 * DAY
  };
  let h = B.health(good);
  eq(h.lines.map(l => l.key), ['weekly', 'master', 'gate', 'storage', 'devices', 'export'], w + ': six lines, in order');
  assert(h.tone === 'ok' && h.lines.every(l => l.tone === 'ok' && l.todo), w + ': all well: every line green, each with what to do');
  assert(!h.bellGate, w + ': no bell');
  assert(/214 trainees, 3,402 records/.test(h.lines[1].text), w + ': the whole-Centre backup\'s age and counts — "' + h.lines[1].text + '"');
  const amber = Object.assign({}, good, { weekly: { checked: true, last: { week: '2026-W43', at: now - 8 * DAY } }, storage: { limit: 15 * G, usage: 12.5 * G },
    lastExport: now - 40 * DAY, devices: Object.assign({}, good.devices, B.stampDevice({}, 'pc-b', { name: 'Donovan Brown' }, now - 12 * DAY)) });
  h = B.health(amber);
  assert(h.tone === 'warn', w + ': amber overall');
  const L = k => h.lines.find(l => l.key === k);
  assert(L('weekly').tone === 'warn' && /Sign in on an office computer/.test(L('weekly').todo), w + ': the weekly backup 8 days old: amber, sign in on an office computer');
  assert(L('storage').tone === 'warn' && /Clear out old class recordings, or empty the trash/.test(L('storage').todo), w + ': storage 83%: the warning');
  assert(L('export').tone === 'warn' && /More than 30 days/.test(L('export').todo), w + ': exported 40 days ago: says so');
  assert(L('devices').tone === 'warn' && /1 silent for more than 7 days/.test(L('devices').text) && L('devices').items.some(i => i.tone === 'warn' && /Donovan Brown/.test(i.text)), w + ': a computer silent for 12 days is flagged, by name');
  const red = Object.assign({}, good, { storageFull: true, master: { savedAt: now - 9 * DAY, students: 1, records: 2 },
    gate: { setUp: true, enabled: true, statusTone: 'bad', statusText: 'Needs attention: the address did not answer. Check that it was copied in full, then try again.', waiting: 3, waitingSince: now - 2 * DAY, judged: true } });
  h = B.health(red);
  assert(h.tone === 'bad' && L('storage').tone === 'bad' && L('master').tone === 'bad' && L('gate').tone === 'bad', w + ': storage full, an old whole-Centre backup, trainee sign-in failing: red');
  assert(/^Needs attention/.test(h.bellGate), w + ': trainee sign-in "Needs attention": the bell');
  h = B.health(Object.assign({}, good, { gate: { setUp: true, enabled: true, statusTone: 'ok', statusText: 'Ready — version 3', waiting: 4, waitingSince: now - 26 * 3600000, judged: true } }));
  assert(L('gate').tone === 'bad' && /4 updates for trainees waiting since/.test(L('gate').text) && /more than a day/.test(h.bellGate), w + ': the oldest unsent copy more than a day old: red, and the bell');
  h = B.health(Object.assign({}, good, { gate: { setUp: true, enabled: true, statusTone: 'ok', statusText: 'Ready — version 3', waiting: 4, waitingSince: now - 26 * 3600000, judged: false } }));
  assert(!h.bellGate, w + ': ...but not before this computer has had its own turn at sending them');
  h = B.health(Object.assign({}, good, { gate: { setUp: true, enabled: false, statusTone: 'bad', statusText: 'Needs attention: x' } }));
  assert(!h.bellGate && /turned off/.test(L('gate').text), w + ': turned off: no bell');
  h = B.health(Object.assign({}, good, { gate: { setUp: false } }));
  assert(L('gate').tone === 'warn' && /Not set up/.test(L('gate').text), w + ': not set up: amber');
  h = B.health({ now, lan: true, lastExport: now });
  eq(h.lines.map(l => l.key), ['weekly', 'master', 'gate', 'export'], w + ': on the Centre\'s own network: no storage or computers lines (not measured there)');
  [good, amber, red].forEach((x, i) => B.health(x).lines.forEach(l => {
    [l.title, l.text, l.todo].concat((l.items || []).map(it => it.text)).forEach(t => assert(!FORBIDDEN.test(t), w + ': no place named (' + i + '/' + l.key + '): "' + t + '"'));
  }));

  console.log('The weekly restore\'s preview (' + w + ')');
  const p = B.restorePreview({ changed: true, restored: { voctrain_students: 2, voctrain_attendanceRegister: 14, cestiSchoolFeePayments: 1 }, restoredKeys: ['voctrain_attendanceRegister', 'voctrain_deletedStudentIds'] });
  eq([p.total, p.lines, p.settings], [17, ['2 trainees', '14 attendance marks', '1 fee payment'], 1], w + ': 17 records, by kind, and one list filled in');
  eq(B.restorePreview({ changed: false, restored: {}, restoredKeys: [] }).total, 0, w + ': nothing to add');

  console.log('This computer\'s own notes never travel (' + w + ')');
  assert(!C.isSnapshotableKey('cestisThisPc_weeklyBackups') && !C.isSnapshotableKey('cestisThisPc_id'), w + ': cestisThisPc_* stays on this computer');
  assert(C.isSnapshotableKey('voctrain_deviceSaves'), w + ': each computer\'s last save travels with the backup');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
