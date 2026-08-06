/* MegaData — admin/device-setup model: settings validation, the export
   filename pinned to the CLI's recogniser, the export→import lossless loop
   through the REAL legacy snapshot builder and the REAL bootstrap extractor,
   config storage pinned to the exact location page-boot reads, and the
   broker probe. Run: node tests/megadata-admin.test.js */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const AM = require('../megadata/pages/admin-model.js');
const BOOT = require('../megadata/bootstrap-core.js');
const Core = require('../cestis-core.js');
const { MemoryAdapter } = require('../megadata/adapters.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }

(async function main() {

  section('Broker settings validation: loud, specific, https-only');
  {
    const good = AM.validateBrokerSettings({ url: '  https://script.google.com/macros/s/AKfy/exec  ', secret: 'a-long-shared-secret-value-123456' });
    ok(good.ok && good.errors.length === 0 && good.warnings.length === 0, 'a real Apps Script URL + long secret validates clean');
    eq(good.url, 'https://script.google.com/macros/s/AKfy/exec', 'the URL is trimmed');
    ok(!AM.validateBrokerSettings({ url: 'http://script.google.com/x', secret: 'long-enough-secret-12345' }).ok, 'plain http is an ERROR, never a warning');
    ok(!AM.validateBrokerSettings({ url: '', secret: 'x'.repeat(20) }).ok, 'missing URL is an error');
    ok(!AM.validateBrokerSettings({ url: 'https://script.google.com/x', secret: '' }).ok, 'missing secret is an error');
    const short = AM.validateBrokerSettings({ url: 'https://script.google.com/x', secret: 'tiny' });
    ok(short.ok && short.warnings.length === 1, 'a suspiciously short secret still saves but WARNS');
    const oddHost = AM.validateBrokerSettings({ url: 'https://example.com/hook', secret: 'x'.repeat(20) });
    ok(oddHost.ok && oddHost.warnings.some(w => /script\.google\.com/.test(w)), 'a non-Google host warns (typo protection), does not block');
  }

  section('Export filename: the CLI recognises every in-app export by name alone');
  {
    const name = AM.exportFileName('Front Desk #2!', '2026-08-06T14:00:00.000Z');
    eq(name, 'master-snapshot.front-desk-2.2026-08-06.json', 'label is slugged, date is the day only');
    eq(BOOT.kindForName(name), 'master-snapshot', 'bootstrap-core routes the export to the master-snapshot extractor');
    eq(BOOT.kindForName(AM.exportFileName('', null)), 'master-snapshot', 'even an unlabelled, undated export is recognised');
    eq(BOOT.kindForName('cestis-master-snapshot.json'), 'master-snapshot', 'the live Drive snapshot name still matches');
    eq(BOOT.kindForName('holiday-photos.json'), null, 'unrelated files are NOT swallowed');
  }

  section('Store-map collector: both store shapes, unreadable keys skipped');
  {
    const fromKeys = AM.storeMapFrom({ keys: () => ['a', 'b'], getItem: k => (k === 'a' ? '1' : '2') });
    eq(fromKeys, { a: '1', b: '2' }, 'CESTISStore shape (keys()/getItem) collects');
    const arr = [['x', 'vx'], ['y', 'vy']];
    const domish = { length: 2, key: i => arr[i][0], getItem: k => (k === 'x' ? 'vx' : 'vy') };
    eq(AM.storeMapFrom(domish), { x: 'vx', y: 'vy' }, 'bare DOM-Storage shape (length/key/getItem) collects');
    const hostile = { keys: () => ['good', 'boom'], getItem: k => { if (k === 'boom') throw new Error('nope'); return 'v'; } };
    eq(AM.storeMapFrom(hostile), { good: 'v' }, 'a key that throws on read is skipped — the export never aborts');
  }

  section('Export → import, losslessly, through the REAL legacy builder and REAL extractor');
  {
    const students = [
      { id: 'SF-901', name: 'Export Case One', skillArea: 'WELDING L2', tuitionFee: 500, updatedAt: '2026-01-02' },
      { id: 'SF-902', name: 'Export Case Two', skillArea: 'COSMETOLOGY L2', tuitionFee: 300 }
    ];
    const payments = [{ id: 'PAYX1', studentId: 'SF-901', amount: 200, date: '2026-02-01', method: 'cash' }];
    const fakeStore = {
      keys: () => ['cestiSchoolFeeStudents', 'cestiSchoolFeePayments', 'cestisGoogleAccessToken', 'voctrain_session_active', 'darkMode'],
      getItem: k => ({
        cestiSchoolFeeStudents: JSON.stringify(students),
        cestiSchoolFeePayments: JSON.stringify(payments),
        cestisGoogleAccessToken: 'ya29.SECRET-TOKEN',
        voctrain_session_active: '{"user":"admin"}',
        darkMode: 'true'
      })[k]
    };
    const snap = Core.buildSnapshot(AM.storeMapFrom(fakeStore), { event: 'admin-export', savedBy: 'test', savedByRole: 'admin' });
    ok(Core.verifySnapshot(snap).ok, 'the built bundle verifies against its own checksum');
    ok(!('cestisGoogleAccessToken' in snap.store), 'the Google token NEVER enters an export bundle');
    ok(!('voctrain_session_active' in snap.store), 'session state NEVER enters an export bundle');
    ok(!('darkMode' in snap.store), 'per-machine view state stays out');
    ok('cestiSchoolFeeStudents' in snap.store, 'the actual data is in');

    const rep = await BOOT.runBootstrap({
      sources: [{ id: 'file:master-snapshot.front-desk.2026-08-06.json', kind: BOOT.kindForName('master-snapshot.front-desk.2026-08-06.json'), name: 'export bundle', json: snap }],
      adapter: MemoryAdapter(), dryRun: true, runStamp: '2026-08-06T00:00:00.000Z', runId: 'imp_admin-1'
    });
    eq(rep.inventory.totals.students, 2, 'both trainees import from the bundle');
    eq(rep.inventory.totals.payments, 1, 'the payment imports');
    ok(rep.verification.financialIdentityHolds, 'the financial identity holds over an in-app export');
    eq(rep.quarantine.length, 0, 'nothing quarantined: every key claimed, excluded-by-rule, or filtered at build time');
  }

  section('Config storage: the admin page writes EXACTLY where page-boot reads');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'megadata', 'page-boot.js'), 'utf8');
    ok(src.indexOf("adapter.get('" + AM.ADMIN_CONFIG_NS + "', '" + AM.ADMIN_CONFIG_KEY + "')") !== -1,
      'drift pin: page-boot.js reads meta/brokerConfig — the same literals admin-model writes');
    const A = MemoryAdapter();
    const w1 = await AM.writeBrokerConfig(A, { url: ' https://script.google.com/macros/s/x/exec ', secret: ' s3cret-s3cret-s3cret ' });
    eq(w1, { url: 'https://script.google.com/macros/s/x/exec', secret: 's3cret-s3cret-s3cret', enforced: false }, 'first save: trimmed, enforced defaults FALSE (cutover is a separate, deliberate act)');
    await A.put(AM.ADMIN_CONFIG_NS, AM.ADMIN_CONFIG_KEY, Object.assign({}, w1, { enforced: true }));
    const w2 = await AM.writeBrokerConfig(A, { url: 'https://script.google.com/macros/s/y/exec', secret: 'rotated-secret-value' });
    ok(w2.enforced === true, 're-saving url/secret PRESERVES the enforced flag — a routine secret rotation cannot un-cutover a device');
    const rd = await AM.readBrokerConfig(A);
    eq(rd.url, 'https://script.google.com/macros/s/y/exec', 'readback returns the latest save');
    await AM.clearBrokerConfig(A);
    eq(await AM.readBrokerConfig(A), null, 'clear removes the config entirely (device back to legacy)');
  }

  section('Broker probe: reachable and unreachable, never throws');
  {
    const okClient = { headq: async () => ({ seq: 42, chain: 'h42' }), gate: async () => ({ gates: { bootstrap: 'sealed' } }) };
    const p1 = await AM.probeBroker(okClient);
    ok(p1.ok && p1.head.seq === 42 && p1.bootstrap === 'sealed', 'a live sealed broker reports its head and gate');
    const coldClient = { headq: async () => ({ seq: 0, chain: 'genesis' }), gate: async () => ({ gates: {} }) };
    const p2 = await AM.probeBroker(coldClient);
    ok(p2.ok && p2.bootstrap === 'not sealed', 'a fresh broker reads as not sealed (pages will stay legacy)');
    const deadClient = { headq: async () => { throw new Error('HTTP 404'); }, gate: async () => ({}) };
    const p3 = await AM.probeBroker(deadClient);
    ok(!p3.ok && /404/.test(p3.error), 'an unreachable broker returns {ok:false, error}, never a thrown exception');
  }

  section('Operator-facing status lines');
  {
    ok(/no broker set up/i.test(AM.describeBoot({ mode: 'legacy' })), 'unconfigured device: plain-language legacy line');
    ok(/migration has not been run/i.test(AM.describeBoot({ mode: 'legacy', reason: 'bootstrap not sealed' })), 'configured-but-unsealed names the migration as the missing step');
    ok(/not reachable/i.test(AM.describeBoot({ mode: 'legacy', reason: 'broker unreachable: HTTP 500' })), 'unreachable broker is named, with the reason');
    ok(/SHADOW/.test(AM.describeBoot({ mode: 'shadow' })), 'shadow mode is named');
    ok(/ENFORCED/.test(AM.describeBoot({ mode: 'enforced' })), 'enforced mode is named');
  }

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
