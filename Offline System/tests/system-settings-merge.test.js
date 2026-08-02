/* Unit tests for CESTISCore.mergeExtSystems / mergeSystemSettings.
   These guard the reported bug: the TMS/NQS headline comment an administrator
   writes disappeared on the next cloud sync.
   Run: node tests/system-settings-merge.test.js */
'use strict';

const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const LOCAL_HEADLINE = 'Enrolment cut-off is Friday 4:00pm.';

/* ---------- 1. The reported bug: a blank cloud copy must not erase the text ---------- */
console.log('Headline survives a blank cloud copy');
let local = { tms: { url: 'https://tms.example/CTI', headline: LOCAL_HEADLINE, mode: 'embed', updatedAt: '2026-08-02T10:00:00.000Z' } };
let remote = { tms: { url: 'https://tms.example/CTI', headline: '', mode: 'embed' } };
let m = Core.mergeExtSystems(local, remote);
assertEq(m.tms.headline, LOCAL_HEADLINE, 'an empty remote headline does not wipe the local one');
assertEq(m.tms.url, 'https://tms.example/CTI', 'url preserved');

// ...and the same when the cloud entry omits the field entirely
m = Core.mergeExtSystems(local, { tms: { url: 'https://tms.example/CTI' } });
assertEq(m.tms.headline, LOCAL_HEADLINE, 'a missing remote headline does not wipe the local one');

// ...and when the cloud has no extSystems at all
m = Core.mergeExtSystems(local, null);
assertEq(m.tms.headline, LOCAL_HEADLINE, 'no remote extSystems leaves the local copy intact');
m = Core.mergeExtSystems(local, {});
assertEq(m.tms.headline, LOCAL_HEADLINE, 'empty remote extSystems leaves the local copy intact');

/* ---------- 2. Genuinely newer remote edits still win ---------- */
console.log('Newer edit wins');
remote = { tms: { url: 'https://tms.example/NEW', headline: 'Updated from another device', mode: 'launch', updatedAt: '2026-08-03T10:00:00.000Z' } };
m = Core.mergeExtSystems(local, remote);
assertEq(m.tms.headline, 'Updated from another device', 'newer remote headline wins');
assertEq(m.tms.url, 'https://tms.example/NEW', 'newer remote url wins');
assertEq(m.tms.mode, 'launch', 'newer remote mode wins');

// An older remote edit must not clobber a newer local one
remote = { tms: { url: 'https://tms.example/OLD', headline: 'Stale text', updatedAt: '2026-07-01T00:00:00.000Z' } };
m = Core.mergeExtSystems(local, remote);
assertEq(m.tms.headline, LOCAL_HEADLINE, 'older remote headline does not overwrite a newer local one');
assertEq(m.tms.url, 'https://tms.example/CTI', 'older remote url does not overwrite a newer local one');

/* ---------- 3. Entries only one side knows about are kept ---------- */
console.log('One-sided entries kept');
m = Core.mergeExtSystems(
  { tms: { url: 'a', headline: 'A' } },
  { nqs: { url: 'b', headline: 'B' } });
assertEq(m.tms.headline, 'A', 'local-only entry kept');
assertEq(m.nqs.headline, 'B', 'remote-only entry adopted');

/* ---------- 4. Both sides have text, neither timestamped ---------- */
console.log('Untimestamped entries');
m = Core.mergeExtSystems(
  { tms: { url: 'local', headline: 'local text' } },
  { tms: { url: 'remote', headline: 'remote text' } });
assert(m.tms.headline === 'local text' || m.tms.headline === 'remote text', 'a headline is retained, not blanked');
assert(!!m.tms.url, 'a url is retained, not blanked');

/* ---------- 5. Whole-settings merge keeps extSystems intact ---------- */
console.log('mergeSystemSettings');
const localSettings = {
  institutionName: 'C.E.S.T.I.S',
  maintenanceMode: false,
  extSystems: {
    tms: { url: 'https://tms.example/CTI', headline: LOCAL_HEADLINE, mode: 'embed', updatedAt: '2026-08-02T10:00:00.000Z' },
    nqs: { url: 'https://nqs.example/qdocs', headline: 'Download qualification documents here.', mode: 'embed', updatedAt: '2026-08-02T10:00:00.000Z' }
  }
};
// The cloud copy predates the External Systems feature entirely.
let merged = Core.mergeSystemSettings(localSettings, { institutionName: 'C.E.S.T.I.S Renamed', maintenanceMode: true });
assertEq(merged.institutionName, 'C.E.S.T.I.S Renamed', 'scalar settings still take the cloud value');
assertEq(merged.maintenanceMode, true, 'maintenance mode still takes the cloud value');
assertEq(merged.extSystems.tms.headline, LOCAL_HEADLINE, 'TMS headline survives a cloud copy with no extSystems');
assertEq(merged.extSystems.nqs.headline, 'Download qualification documents here.', 'NQS headline survives too');

// The cloud copy carries factory-default (blank) external systems.
merged = Core.mergeSystemSettings(localSettings, {
  extSystems: { tms: { url: 'https://tms.heart-nta.org/CTI/default.aspx', headline: '' },
                nqs: { url: 'https://nqs-certification.heart-nta.org/qdocs.aspx', headline: '' } }
});
assertEq(merged.extSystems.tms.headline, LOCAL_HEADLINE, 'blank cloud defaults do not erase the TMS headline');
assertEq(merged.extSystems.nqs.headline, 'Download qualification documents here.', 'blank cloud defaults do not erase the NQS headline');

// Repeated syncs must be stable — this is what "disappears on next sync" looked like.
let s1 = Core.mergeSystemSettings(localSettings, { extSystems: { tms: { url: 'x', headline: '' } } });
let s2 = Core.mergeSystemSettings(s1, { extSystems: { tms: { url: 'x', headline: '' } } });
let s3 = Core.mergeSystemSettings(s2, { extSystems: { tms: { url: 'x', headline: '' } } });
assertEq(s3.extSystems.tms.headline, LOCAL_HEADLINE, 'headline still present after three consecutive syncs');

/* ---------- 6. Null-safety ---------- */
console.log('Null safety');
assert(!!Core.mergeSystemSettings(null, null), 'merging nulls returns an object');
assertEq(Object.keys(Core.mergeSystemSettings(null, null)).length, 0, 'merging nulls yields an empty object');
assertEq(Core.mergeSystemSettings(localSettings, null).extSystems.tms.headline, LOCAL_HEADLINE, 'null remote keeps local settings');
assertEq(Core.mergeSystemSettings(null, localSettings).extSystems.tms.headline, LOCAL_HEADLINE, 'null local adopts remote settings');

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
