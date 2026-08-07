/* MegaData — fetch the legacy Drive backups THROUGH the broker (which runs
   inside the school's Google account), so the operator never downloads
   files by hand and never needs to know folder ids.

   The broker's 'listLegacy' op searches the whole Drive by the exact backup
   filenames below; the same backup often exists in several folders (the
   inventory found ~12), so this picks the NEWEST copy of each name and
   REPORTS every duplicate it passed over — loud, never silent. Files land
   verbatim in the sources directory, so the migration's inventory hashes
   exactly what was fetched and the review artifact stays honest. */
'use strict';
const fs = require('fs');
const path = require('path');

/* Every fixed legacy filename the extractors recognise (KIND_BY_NAME's
   concrete names — pattern-matched device exports are downloads, not Drive
   files, so they are added to the folder by hand as before). */
const LEGACY_NAMES = [
  'CESTIS_School_Fees.json', 'school_fee_management_system.json',
  'CESTIS_Student_Progress.json', 'CESTIS_Transcript_Requests.json',
  'CESTIS_Transcript_Grades.json', 'CESTIS_LMS_BACKUP.json',
  'CESTIS_LMS_Dashboard.json', 'cestis-master-snapshot.json', 'CESTIS_ALL_DATA.json',
  'CESTIS_Cashbook.json', 'CESTIS_Virement_Requests.json',
  'CESTIS_Finance_Invoices.json', 'CESTIS_Finance_Quotes.json',
  'CESTIS_Finance_PurchaseOrders.json', 'CESTIS_Payments_Invoices.json',
  'CESTIS_Payment_Vouchers.json', 'CESTIS_Staff_Payslips.json',
  'CESTIS_Staff_TimeClock.json'
];

function fetchLegacySources(opts) {
  const client = opts.client, destDir = opts.destDir;
  const names = opts.names || LEGACY_NAMES;
  const log = opts.log || function () {};
  fs.mkdirSync(destDir, { recursive: true });
  return client._call('listLegacy', { names: names, folderIds: opts.folderIds || [] }).then(function (res) {
    const byName = {};
    (res.files || []).forEach(function (f) {
      if (f.error) { log('  ⚠ ' + f.error); return; }
      (byName[f.name] = byName[f.name] || []).push(f);
    });
    const report = { downloaded: [], duplicates: [], missing: [] };
    let chain = Promise.resolve();
    names.forEach(function (nm) {
      const copies = (byName[nm] || []).sort(function (a, b) { return String(b.modified).localeCompare(String(a.modified)); });
      if (!copies.length) { report.missing.push(nm); return; }
      const newest = copies[0];
      if (copies.length > 1) {
        report.duplicates.push({ name: nm, used: newest, passedOver: copies.slice(1) });
        log('  ' + nm + ': ' + copies.length + ' copies on Drive — using the newest (' + newest.modified + ', folder "' + newest.folder + '")');
      }
      chain = chain.then(function () {
        return client._call('fetchLegacy', { fileId: newest.id }).then(function (file) {
          fs.writeFileSync(path.join(destDir, nm), file.content);
          report.downloaded.push({ name: nm, size: file.content.length, modified: newest.modified, folder: newest.folder });
          log('  ✓ ' + nm + ' (' + Math.round(file.content.length / 1024) + ' KB, ' + newest.modified.slice(0, 10) + ')');
        });
      });
    });
    return chain.then(function () { return report; });
  });
}

module.exports = { fetchLegacySources, LEGACY_NAMES };
