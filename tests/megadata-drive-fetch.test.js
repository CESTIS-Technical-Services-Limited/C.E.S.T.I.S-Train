/* MegaData — Drive fetch through the broker: whole-Drive search by exact
   backup names, newest-copy-wins with every duplicate REPORTED, verbatim
   writes the migration then ingests, missing files listed not fatal, and
   the fetched set flows straight into a real dry run.
   Run: node tests/megadata-drive-fetch.test.js */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const MD = require('../megadata/schemas.js');
const { createBrokerClient } = require('../megadata/broker-client.js');
const { fetchLegacySources, LEGACY_NAMES } = require('../megadata/drive-fetch.js');
const { MemoryAdapter } = require('../megadata/adapters.js');
const BOOT = require('../megadata/bootstrap-core.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const SECRET = 'drive-fetch-secret-0123456789abcdef';

const FEE_PAYLOAD = JSON.stringify({ data: {
  cestiSchoolFeeStudents: JSON.stringify([{ id: 'SF-D1', name: 'Drive Case', skillArea: 'WELDING L2', tuitionFee: 100 }]),
  cestiSchoolFeePayments: JSON.stringify([{ id: 'PD1', studentId: 'SF-D1', amount: 40, date: '2026-03-01', method: 'cash' }]),
  cestiFeeStructure: '{}', cestiSchoolFeeDeletedPaymentIds: '[]', cestiSchoolFeeDeletedLmsIds: '[]'
} });

/* A Code.gs-dialect stand-in for the two Drive ops: files by name, several
   folders, one name duplicated with different timestamps. */
function driveDialect(files) {
  const fetchImpl = async (url, init) => {
    const req = JSON.parse(init.body);
    const auth = await MD.sha256Hex(SECRET + '|' + MD.canon(req.payload || {}));
    let out;
    if (req.auth !== auth) out = { error: 'auth failed' };
    else if (req.op === 'listLegacy') {
      out = { files: files.filter(f => (req.payload.names || []).includes(f.name)).map(f => ({ id: f.id, name: f.name, size: f.content.length, modified: f.modified, folder: f.folder })) };
    } else if (req.op === 'fetchLegacy') {
      const f = files.find(x => x.id === req.payload.fileId);
      out = f ? { name: f.name, modified: f.modified, content: f.content } : { error: 'fetch failed: no such file' };
    } else out = { error: 'unknown op ' + req.op };
    return { status: 200, text: async () => JSON.stringify(out) };
  };
  return fetchImpl;
}

(async function main() {

  section('Whole-Drive search: newest copy wins, duplicates reported, files land verbatim');
  const DRIVE = [
    { id: 'f1', name: 'CESTIS_School_Fees.json', folder: 'CESTIS-LIVE', modified: '2026-08-01T10:00:00.000Z', content: FEE_PAYLOAD },
    { id: 'f2', name: 'CESTIS_School_Fees.json', folder: 'Old backups', modified: '2025-11-02T09:00:00.000Z', content: '{"data":{}}' },
    { id: 'f3', name: 'CESTIS_Cashbook.json', folder: 'CESTIS-LIVE', modified: '2026-08-02T08:00:00.000Z', content: JSON.stringify({ data: {} }) }
  ];
  const client = createBrokerClient({ url: 'https://x/exec', secret: SECRET, fetchImpl: driveDialect(DRIVE), sleep: () => Promise.resolve() });
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mega-fetch-'));
  const logLines = [];
  const rep = await fetchLegacySources({ client, destDir: dest, log: l => logLines.push(l) });
  eq(rep.downloaded.map(d => d.name).sort(), ['CESTIS_Cashbook.json', 'CESTIS_School_Fees.json'], 'both present names downloaded');
  eq(rep.duplicates.length, 1, 'the duplicated name is reported');
  eq(rep.duplicates[0].used.id, 'f1', 'and the NEWEST copy was the one used');
  eq(rep.duplicates[0].passedOver[0].id, 'f2', 'with the stale copy named, not hidden');
  eq(fs.readFileSync(path.join(dest, 'CESTIS_School_Fees.json'), 'utf8'), FEE_PAYLOAD, 'content written VERBATIM (the inventory hashes exactly this)');
  eq(rep.missing.length, LEGACY_NAMES.length - 2, 'every absent name is listed as missing, none silently dropped');
  ok(logLines.some(l => /2 copies/.test(l)), 'the duplicate choice was narrated');

  section('The fetched folder flows straight into a real dry run');
  const sources = [];
  for (const f of fs.readdirSync(dest).sort()) {
    const kind = BOOT.kindForName(f);
    if (kind) sources.push({ id: 'file:' + f, kind, name: f, json: JSON.parse(fs.readFileSync(path.join(dest, f), 'utf8')) });
  }
  const rep2 = await BOOT.runBootstrap({ sources, adapter: MemoryAdapter(), dryRun: true, runStamp: '2026-08-06T00:00:00.000Z', runId: 'imp_df-1' });
  eq(rep2.inventory.totals.students, 1, 'the fetched fee backup imports');
  ok(rep2.verification.financialIdentityHolds, 'and the financial identity holds over fetched sources');

  section('A wrong secret is refused before any file content moves');
  const badClient = createBrokerClient({ url: 'https://x/exec', secret: 'wrong', fetchImpl: driveDialect(DRIVE), sleep: () => Promise.resolve(), maxRetries: 0 });
  let err = null;
  await fetchLegacySources({ client: badClient, destDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mega-fetch2-')) }).catch(e => { err = e; });
  ok(err && /auth failed/.test(err.message), 'auth failure surfaces loudly');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
