/* Virement: an edited request loses its approval, everywhere, for good.

   An approved virement for $44,288.25, signed by two people, was edited to
   $444,288.25. The edit set it back to Pending — and the very next save put
   "Approved" back from the stored copy, and the cloud merge then copied the
   original two signatures onto the NEW amount. The printed form read
   "✓ APPROVED by Admin One and Board Two" over a figure nobody had agreed to,
   and with cloud connected it counted as fully approved and was pushed to
   Drive. (finance-06)

   Also: the menu's "Sync from Cloud" and "Merge from Cloud" dropped a first
   signature (an "Awaiting Second Signature" request went back to Pending) and
   ordered rulings by the date only (finance-22); "Merge from Cloud" copied a
   whole cloud record over a local edit whenever the request DATE was later.

   Driven through the page's real submitVirement, saveAllData,
   autoSaveApprovalToCloud, syncFromCloud and vrMergeRequest.

   Run: node tests/virement-edit-approval.test.js [page] */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
const ROOT = path.join(__dirname, '..');
// The Offline System copy is regenerated from this page by the offline build.
const PAGES = process.argv[2] ? [process.argv[2]] : [path.join(ROOT, 'Virement.Request.html')];
let SRC = '', PAGE = '';

function extractFunction(name) {
  let at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) at = SRC.indexOf('\nasync function ' + name + '(');
  if (at < 0) throw new Error(PAGE + ' no longer defines ' + name);
  let depth = 0, i = SRC.indexOf('{', at);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(at, i + 1);
}
const clone = o => JSON.parse(JSON.stringify(o));

const SIG_A = { id: 'U-A', name: 'Admin One', role: 'admin', at: '2026-10-19T10:00:00.000Z' };
const SIG_B = { id: 'U-B', name: 'Board Two', role: 'cmc', at: '2026-10-19T11:00:00.000Z' };
function approved() {
  return { id: 1700000000001, date: '2026-10-19', fy: '2026/2027', quarter: 3, project: 'P', period: 'Q3',
    requestedBy: 'Clerk', position: 'Bursar', total: 44288.25, totalWords: 'x',
    lines: [{ fromId: 'b1', fromName: 'Rent', toId: 'b2', toName: 'Utilities', amount: 44288.25 }],
    deficitComment: '', anyLineComment: '', status: 'Approved', approvedBy: 'Admin One and Board Two',
    approvalDate: '2026-10-19', approvalAt: '2026-10-19T11:00:00.000Z', signatures: [SIG_A, SIG_B] };
}

function makePage(store0, cloud) {
  const backing = Object.assign({}, store0 || {});
  const store = { getItem: k => (k in backing ? backing[k] : null), setItem: (k, v) => { backing[k] = String(v); }, removeItem: k => { delete backing[k]; } };
  const uploads = [];
  const formValues = { vDate: '2026-10-19', vProjectName: 'P', vPeriod: 'Q3', vRequestedBy: 'Clerk', vPosition: 'Bursar',
    deficitComment: '', anyLineComment: '' };
  let entryAmount = '444288.25';
  const entry = { querySelector: sel => ({ '.vl-from': { value: 'b1' }, '.vl-to': { value: 'b2' }, '.vl-amount': { value: entryAmount } })[sel] };
  const sb = {
    CESTISStore: store, console: { log() {}, warn() {}, error() {} }, alert() {}, confirm: () => true,
    virementRequests: [], deletedRequestIds: new Set(), DELETED_IDS_KEY: 'cesti_virement_deleted_ids',
    editingVirementIdx: -1, adminUnlocked: false, virementActiveFY: '2026/2027', virementActiveQ: 3,
    budgetData: [{ id: 'b1', name: 'Rent' }, { id: 'b2', name: 'Utilities' }], cloudQuarterCache: {},
    isCloudConnected: true, googleAccessToken: 'tok', cloudFileId: 'VFILE', lastSyncTime: null, lastSavedBy: null, cloudFileTimestamp: null,
    GOOGLE_DRIVE_CONFIG: { BACKUP_FILE_NAME: 'v.json', FOLDER_ID: 'F' },
    document: {
      querySelectorAll: sel => (sel === '#virementLines .virement-entry' ? [entry] : []),
      getElementById: id => (id in formValues ? { value: formValues[id], style: {}, textContent: '' } : { value: '', style: {}, textContent: '' })
    },
    Date, Object, Array, String, JSON, Math, Number, Promise, Set, Map, Error, parseFloat
  };
  sb.window = sb;
  ['clearFormDraft', 'clearVirementForm', 'renderRequests', 'renderBudgetOverview', 'renderAdminApprovals',
   'findExistingBackupFile', 'updateLastSyncDisplay', 'updateLastSavedByDisplay', 'saveCloudCache', 'renderPrintPreview',
   'updateQuarterTabIndicators', 'setCloudSyncing'].forEach(n => { sb[n] = () => {}; });
  sb.numberToWords = n => String(n);
  sb.fetch = async (url, init) => {
    if (init && (init.method === 'PATCH' || init.method === 'POST')) { uploads.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ id: 'VFILE' }) }; }
    return { ok: true, json: async () => clone(cloud) };
  };
  vm.createContext(sb);
  vm.runInContext(['vrSignatures', 'vrContentRev', 'vrValidSignatures', 'vrIsApproved', 'vrMergeRequest',
    'deduplicateRequests', 'saveAllData', 'submitVirement', 'autoSaveApprovalToCloud'].map(extractFunction).join('\n\n'), sb);
  sb._backing = backing; sb._uploads = uploads;
  return sb;
}

async function runFor(file) {
  SRC = fs.readFileSync(file, 'utf8');
  PAGE = path.relative(ROOT, file);
  console.log('\n=== ' + PAGE + ' ===');

  console.log('An approved virement edited to a new amount stays unapproved after save and cloud merge');
  {
    const req = approved();
    const pg = makePage({ cesti_virements: JSON.stringify([req]) },
      { version: '1.2', data: { virementRequests: [approved()], deletedRequestIds: [] } });
    pg.virementRequests = [clone(req)];
    pg.editingVirementIdx = 0;
    pg.submitVirement();                         // runs saveAllData and autoSaveApprovalToCloud
    await new Promise(r => setTimeout(r, 0));
    await pg.autoSaveApprovalToCloud();          // and once more, awaited
    const r = pg.virementRequests[0];
    assert(r.total === 444288.25, PAGE + ': the edit is kept (total ' + r.total + ')');
    assert(r.status === 'Pending' && (r.signatures || []).length === 0, PAGE + ': status Pending with no signatures (got ' + r.status + ', ' + (r.signatures || []).length + ')');
    assert(pg.vrIsApproved(r) === false, PAGE + ': not approved');
    const stored = JSON.parse(pg._backing.cesti_virements)[0];
    assert(stored.status === 'Pending' && !pg.vrIsApproved(stored), PAGE + ': the stored copy is not approved either');
    const up = pg._uploads[pg._uploads.length - 1];
    assert(up && up.data.virementRequests[0].total === 444288.25 && !pg.vrIsApproved(up.data.virementRequests[0]),
      PAGE + ': and what is pushed to Drive is the unapproved edit');
  }

  console.log('Another device takes the edit, and drops its stale approval');
  {
    const pg = makePage({}, null);
    const mine = approved();
    const edited = Object.assign(approved(), { total: 444288.25, status: 'Pending', signatures: [], approvedBy: '',
      approvalAt: '', approvalDate: '', editedAt: '2026-10-20T09:00:00.000Z' });
    edited.lines[0].amount = 444288.25;
    pg.vrMergeRequest(mine, edited);
    assert(mine.total === 444288.25 && mine.status === 'Pending' && !pg.vrIsApproved(mine), PAGE + ': the later edit wins whole');
  }

  console.log('A signature made on other content does not count');
  {
    const pg = makePage({}, null);
    const r = approved();
    const rev = pg.vrContentRev(r);
    r.signatures = [Object.assign({}, SIG_A, { rev }), Object.assign({}, SIG_B, { rev })];
    assert(pg.vrIsApproved(r) === true, PAGE + ': two signatures on this content approve it');
    r.total = 444288.25; r.lines[0].amount = 444288.25;
    assert(pg.vrIsApproved(r) === false, PAGE + ': the same signatures on a changed amount do not');
  }

  console.log('Two first signatures from two devices make an approval; none is dropped (finance-22)');
  {
    const pg = makePage({}, null);
    const base = Object.assign(approved(), { status: 'Awaiting Second Signature', signatures: [SIG_A], approvalAt: SIG_A.at });
    const other = Object.assign(approved(), { status: 'Awaiting Second Signature', signatures: [SIG_B], approvalAt: SIG_B.at });
    pg.vrMergeRequest(base, other);
    assert(base.status === 'Approved' && base.signatures.length === 2 && pg.vrIsApproved(base), PAGE + ': united, it is approved');
    const local = Object.assign(approved(), { status: 'Awaiting Second Signature', signatures: [SIG_A], approvalAt: SIG_A.at });
    const cloudPending = Object.assign(approved(), { status: 'Pending', signatures: [], approvalAt: '', approvalDate: '' });
    pg.vrMergeRequest(local, cloudPending);
    assert(local.status === 'Awaiting Second Signature' && local.signatures.length === 1, PAGE + ': a cloud copy still Pending does not drop the first signature');
  }

  console.log('The menu syncs use the same rule');
  ['syncFromCloud', 'mergeFromCloud', 'autoMergeFromCloudOnLoad', 'autoSaveApprovalToCloud', 'saveAllData'].forEach(n => {
    assert(/vrMergeRequest\(/.test(extractFunction(n)), PAGE + ': ' + n + ' merges through vrMergeRequest');
  });
  assert(!/cloudRequest\.date > local\.date\) \{\s*Object\.assign\(local, cloudRequest\)/.test(SRC), PAGE + ': no whole-record copy decided by the request date');
  assert(/let badge = vrIsApproved\(r\)/.test(SRC) && /\$\{vrIsApproved\(r\)\?'✓ APPROVED'/.test(SRC), PAGE + ': the badge and the printed form say Approved only when it is');
}

(async () => {
  for (const f of PAGES) await runFor(f);
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
