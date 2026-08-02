/* Unit tests for CESTISCore.pageCloud — the rules behind each page's own
   Google Drive backup file.

   Every page that owns data now writes its own file into the shared backup
   folder, instead of reaching Drive only when the LMS dashboard happened to be
   open. Two devices editing the same page have to converge without either
   one's work vanishing, which is what these tests pin.

   Run: node tests/page-cloud.test.js */
'use strict';

const Core = require('../cestis-core.js');
const PC = Core.pageCloud;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const OLD = '2026-07-01T09:00:00.000Z';
const NEW = '2026-08-01T09:00:00.000Z';

/* ---------- 1. Which keys a page is responsible for ---------- */
console.log('A page claims only its own keys');
const cashbook = { page: 'Cashbook', file: 'CESTIS_Cashbook.json',
  keys: ['cesti_cashbook_data', 'cestis_active_quarter'], prefixes: ['cestis_quarter_', 'cestis_budget_'] };

assertEq(PC.ownsKey(cashbook, 'cesti_cashbook_data'), true, 'an exact key is claimed');
assertEq(PC.ownsKey(cashbook, 'cestis_quarter_2026/2027_Q2'), true, 'a generated quarter key is claimed by prefix');
assertEq(PC.ownsKey(cashbook, 'cestis_budget_2026/2027_Q2'), true, 'a generated budget key is claimed by prefix');
assertEq(PC.ownsKey(cashbook, 'cestis_finance_invoices'), false, 'another page\'s data is not claimed');
assertEq(PC.ownsKey(cashbook, 'schoolDashboardGoogleAccessToken'), false, 'the access token is never backed up');
assertEq(PC.ownsKey(cashbook, ''), false, 'blank key');
assertEq(PC.ownsKey(null, 'x'), false, 'null-safe');

const full = {
  'cesti_cashbook_data': '{"a":1}',
  'cestis_quarter_2026/2027_Q2': '{"transactions":[]}',
  'cestis_finance_invoices': '[]',
  'schoolDashboardGoogleAccessToken': 'secret-token'
};
const mine = PC.collect(cashbook, full);
assertEq(Object.keys(mine).length, 2, 'only this page\'s keys are collected');
assertEq(mine['cestis_finance_invoices'], undefined, 'another page\'s data stays out of this file');
assertEq(mine['schoolDashboardGoogleAccessToken'], undefined, 'the token never reaches the backup file');

/* ---------- 2. Newest write wins, per key ---------- */
console.log('The newer write wins, key by key');
/* This device edited the quarter after the cloud copy was written. A sync must
   not roll that back — the same rule the student and account merges follow. */
let res = PC.mergeKeys(
  { q: 'local-newer' }, { q: NEW },
  { q: 'cloud-older' }, { q: OLD });
assertEq(res.data.q, 'local-newer', 'a newer local edit survives the pull');
assertEq(res.changed.length, 0, 'and nothing is rewritten locally');

res = PC.mergeKeys(
  { q: 'local-older' }, { q: OLD },
  { q: 'cloud-newer' }, { q: NEW });
assertEq(res.data.q, 'cloud-newer', 'a newer cloud edit is taken');
assertEq(res.changed[0], 'q', 'and is reported so the caller writes it locally');

/* Two pages of work on different keys must both survive — this is the case
   that a whole-file overwrite used to lose. */
res = PC.mergeKeys(
  { a: 'mine', b: 'untouched' }, { a: NEW },
  { b: 'theirs', c: 'theirs-new' }, { b: OLD, c: NEW });
assertEq(res.data.a, 'mine', 'my key is kept');
assertEq(res.data.b, 'untouched', 'my unstamped value is not overwritten by an older cloud one');
assertEq(res.data.c, 'theirs-new', 'their new key arrives');
assert(res.changed.indexOf('c') > -1, 'the new key is reported as changed');

/* A key only one side has is new work, never a deletion. */
res = PC.mergeKeys({ a: '1' }, {}, {}, {});
assertEq(res.data.a, '1', 'a local-only key stays');
res = PC.mergeKeys({}, {}, { b: '2' }, { b: NEW });
assertEq(res.data.b, '2', 'a cloud-only key arrives');
assertEq(res.changed[0], 'b', 'and is reported');

/* Identical values are not churn. */
res = PC.mergeKeys({ a: 'same' }, { a: OLD }, { a: 'same' }, { a: NEW });
assertEq(res.changed.length, 0, 'identical values produce no rewrite even when the cloud stamp is newer');

/* Undatable work is never thrown away. */
res = PC.mergeKeys({ a: 'local' }, {}, { a: 'cloud' }, {});
assertEq(res.data.a, 'local', 'with no stamps on either side the local value stands');

assertEq(PC.mergeKeys(null, null, null, null).changed.length, 0, 'null-safe');

/* ---------- 3. Merging is stable when repeated ---------- */
console.log('Syncing twice changes nothing further');
const localData = { a: 'mine', b: 'shared' }, localStamps = { a: NEW, b: OLD };
const cloudData = { b: 'shared', c: 'theirs' }, cloudStamps = { b: OLD, c: NEW };
const first = PC.mergeKeys(localData, localStamps, cloudData, cloudStamps);
const second = PC.mergeKeys(first.data, first.stamps, cloudData, cloudStamps);
assertEq(JSON.stringify(second.data), JSON.stringify(first.data), 'a second pass produces the same result');
assertEq(second.changed.length, 0, 'and reports nothing further to write');

/* ---------- 4. What actually lands in Drive ---------- */
console.log('The backup file says which page wrote it');
const payload = PC.buildPayload(cashbook, { 'cesti_cashbook_data': '{}' }, { 'cesti_cashbook_data': NEW },
  { savedAt: NEW, savedBy: 'cestisadmin' });
assertEq(payload.page, 'Cashbook', 'the page names itself in its file');
assertEq(payload.file, 'CESTIS_Cashbook.json', 'the file records its own name');
assertEq(payload.keyCount, 1, 'the key count is recorded');
assertEq(payload.savedBy, 'cestisadmin', 'who saved it');
assertEq(payload.data['cesti_cashbook_data'], '{}', 'the data is carried');
assertEq(payload.stamps['cesti_cashbook_data'], NEW, 'and its stamp, so the next device can merge');
assert(!!payload.version, 'the format is versioned');

/* ---------- 5. Pages do not collide ---------- */
console.log('Each page writes a different file');
const specs = [
  { page: 'Payments / Invoices', file: 'CESTIS_Payments_Invoices.json', keys: ['cestis_finance_invoices'] },
  { page: 'Payment Vouchers', file: 'CESTIS_Payment_Vouchers.json', keys: ['cestis_finance_voucher_overrides'] },
  { page: 'Cashbook', file: 'CESTIS_Cashbook.json', keys: ['cesti_cashbook_data'] },
  { page: 'Virement Requests', file: 'CESTIS_Virement_Requests.json', keys: ['cesti_virements'] }
];
const files = specs.map(function (s) { return s.file; });
assertEq(new Set(files).size, files.length, 'every page has its own file name');
/* A key claimed by two pages would have them overwrite each other's file
   contents; the shared finance keys are the ones to watch. */
specs.forEach(function (a) {
  specs.forEach(function (b) {
    if (a === b) return;
    const overlap = (a.keys || []).filter(function (k) { return PC.ownsKey(b, k); });
    assertEq(overlap.length, 0, a.page + ' and ' + b.page + ' claim no key in common');
  });
});


/* ---------- 6. A device's first sync of a page ---------- */
console.log('A device syncing a page for the first time adopts the Centre\'s data');
/* Several pages seed their own start-up defaults into storage as they load.
   On a machine that has never synced that page, those defaults must not beat
   the real data in the cloud — otherwise opening the page on a new machine
   keeps its blank template and pushes that up over everyone's work. */
let fresh = PC.mergeKeys(
  { 'cesti_virements': '[{"id":1,"seeded":true}]' }, {},          // page's own defaults, unstamped
  { 'cesti_virements': '[{"id":"V-3","real":true}]' }, { 'cesti_virements': NEW },
  { firstSync: true });
assertEq(fresh.data['cesti_virements'], '[{"id":"V-3","real":true}]', 'the Centre\'s data wins the first sync');
assertEq(fresh.changed[0], 'cesti_virements', 'and is written locally');

/* Once the device has synced, the conservative rule takes over again. */
let later = PC.mergeKeys(
  { 'cesti_virements': '[{"edited":"here"}]' }, { 'cesti_virements': NEW },
  { 'cesti_virements': '[{"id":"V-3"}]' }, { 'cesti_virements': OLD },
  { firstSync: false });
assertEq(later.data['cesti_virements'], '[{"edited":"here"}]', 'after the first sync, newer local work stands');

/* First sync never invents a value the cloud does not have. */
let onlyLocal = PC.mergeKeys({ a: 'mine' }, {}, {}, {}, { firstSync: true });
assertEq(onlyLocal.data.a, 'mine', 'a key the cloud lacks is kept on a first sync');
assertEq(onlyLocal.changed.length, 0, 'and is not reported as changed');

/* An undated cloud value cannot displace local data even on a first sync. */
let undated = PC.mergeKeys({ a: 'mine' }, {}, { a: 'theirs' }, {}, { firstSync: true });
assertEq(undated.data.a, 'mine', 'an unstamped cloud value never wins');

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
