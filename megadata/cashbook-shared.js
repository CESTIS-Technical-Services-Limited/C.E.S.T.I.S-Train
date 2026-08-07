/* MegaData — the ONE cashbook amount/class resolver, shared verbatim by the
   bootstrap pipeline (inventory + synthesis) and the live page bridge, so the
   cashbook financial identity holds by construction on both paths (D11: its
   own book). Voided cheques resolve to their _orig* values — the entry
   imports/bridges at its original amount, then a voided event supersedes it
   to zero, exactly like the legacy page's own calcTotals treats them. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MegaData = Object.assign(root.MegaData || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function cbToMinor(x) {
    var n = Number(x);
    if (!isFinite(n)) n = 0;
    var minor = Math.round(n * 100);
    return { minor: minor, exact: Math.abs(n * 100 - minor) < 1e-6 };
  }

  function cbAmount(txn) {
    var voided = String(txn.category || '') === 'Cancelled' && (txn._origPayment != null || txn._origDeposit != null || txn._origCategory != null);
    var dep = cbToMinor(voided && txn._origDeposit != null ? txn._origDeposit : txn.deposit).minor;
    var pay = cbToMinor(voided && txn._origPayment != null ? txn._origPayment : txn.payment).minor;
    var category = voided ? (txn._origCategory || txn.category) : txn.category;
    var payee = voided ? (txn._origDetails || txn.details) : txn.details;
    if (dep > 0 && pay > 0) return { klass: 'ambiguous' };
    if (dep === 0 && pay === 0) return { klass: String(txn.category || '') === 'Cancelled' ? 'cancelled-zero' : 'zero' };
    return { klass: dep > 0 ? 'income' : 'expense', amountMinor: dep > 0 ? dep : pay, category: String(category || 'Uncategorised'), payee: String(payee || ''), voided: voided };
  }

  return { cbAmount: cbAmount, cbToMinor: cbToMinor };
});
