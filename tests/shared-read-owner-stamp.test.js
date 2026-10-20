/* A page that only READS the Cashbook's quarters never overwrites an entry
   the Cashbook made on this device and has not yet uploaded.

   Income & Expenditure and the CMC oversight board pull the Cashbook's
   quarters from CESTIS_Cashbook.json. They judged recency against their OWN
   stamp map, which only records when they last took a key from the cloud; a
   cheque the Cashbook entered here afterwards (stamped in the Cashbook's map)
   was invisible to them, so any newer cloud copy replaced it — and on the
   first pull, with no stamps of their own yet, the cloud copy replaced it
   outright. (finance-15)

   Driven through the real cestis-page-cloud.js pullShared with a fake Drive.

   Run: node tests/shared-read-owner-stamp.test.js */
'use strict';

const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const KEY = 'cestis_quarter_2026/2027_Q3';
const LOCAL_Q = JSON.stringify({ openingBalance: 0, transactions: [{ id: 100, uid: 'T-7781', details: 'Cheque 7781', payment: 64000 }] });
const CLOUD_Q = JSON.stringify({ openingBalance: 0, transactions: [{ id: 100, uid: 'T-st', details: 'Other PC: Stationery', payment: 2500 }] });

function run(ownerStamp, readerStamps) {
  const local = {
    schoolDashboardGoogleAccessToken: 'tok',
    schoolDashboardGoogleTokenExpiry: new Date(Date.now() + 3600e3).toISOString(),
    [KEY]: LOCAL_Q,
    'cestis_pagecloud_stamps__CESTIS_Cashbook.json': JSON.stringify(ownerStamp ? { [KEY]: ownerStamp } : {}),
    'cestis_pagecloud_stamps__CESTIS_Income_Expenditure_Test.json': JSON.stringify(readerStamps || {})
  };
  global.CESTISStore = {
    getItem: k => (Object.prototype.hasOwnProperty.call(local, k) ? local[k] : null),
    setItem: (k, v) => { local[k] = String(v); },
    keys: () => Object.keys(local)
  };
  global.CESTISCore = Core;
  const DRIVE = { 'CESTIS_Cashbook.json': { data: { [KEY]: CLOUD_Q }, stamps: { [KEY]: '2026-10-20T10:15:00.000Z' } } };
  global.fetch = function (url) {
    if (/files\?q=/.test(url)) {
      const name = decodeURIComponent(url).match(/name='([^']+)'/)[1];
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ files: DRIVE[name] ? [{ id: 'id-' + name }] : [] }) });
    }
    const media = url.match(/files\/id-([^?]+)\?alt=media/);
    if (media) return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify(DRIVE[media[1]]))) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  delete require.cache[require.resolve('../cestis-page-cloud.js')];
  const PageCloud = require('../cestis-page-cloud.js');
  const pg = PageCloud.init({ page: 'I&E test', file: 'CESTIS_Income_Expenditure_Test.json', readOnly: true, keys: [], reads: ['cestis_quarter_*'] });
  return new Promise(r => setTimeout(r, 30)).then(() => pg.pullShared()).then(() => local[KEY]);
}

console.log('An unpushed Cashbook entry (owner stamp newer than the cloud) is kept by a reader');
run('2026-10-20T11:30:00.000Z', { [KEY]: '2026-10-20T09:00:00.000Z' })
  .then(v => {
    assert(v === LOCAL_Q, 'the $64,000 cheque entered here is still stored after the reader pulled');
    console.log('…including on the reader\'s very first pull');
    return run('2026-10-20T11:30:00.000Z', {});
  })
  .then(v => {
    assert(v === LOCAL_Q, 'a first pull does not replace it either');
    console.log('A cloud copy newer than both stamps is still taken');
    return run('2026-10-20T08:00:00.000Z', { [KEY]: '2026-10-20T07:00:00.000Z' });
  })
  .then(v => {
    assert(v === CLOUD_Q, 'the reader still follows the cloud when nothing newer is held here');
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  })
  .catch(e => { console.error('  ✗ FAIL: threw — ' + e.stack); process.exit(1); });
