/* MegaData — admin/device-setup model (pure logic; Phase 5 step 8).
   Everything the MegaData-Admin page does that can be tested in Node lives
   here: broker-settings validation, the export-bundle filename convention
   (pinned to bootstrap-core's KIND_BY_NAME so the CLI always recognises an
   in-app export), the store-map collector, the broker probe, and the exact
   meta location page-boot reads its config from.

   The broker secret NEVER leaves this device: it is written to the local
   meta store only (IndexedDB CESTIS_MEGA), which is outside CESTISStore and
   therefore can never appear in an export bundle, a cloud sync, or the repo
   (public, D3). */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MegaData = Object.assign(root.MegaData || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* Where page-boot reads the per-device config. A drift test pins these
     literals against page-boot.js — change them together or not at all. */
  var CONFIG_NS = 'meta', CONFIG_KEY = 'brokerConfig';

  function validateBrokerSettings(input) {
    input = input || {};
    var url = String(input.url || '').trim();
    var secret = String(input.secret || '').trim();
    var errors = [], warnings = [];
    if (!url) errors.push('The broker web address is required.');
    else {
      var m = /^(https?):\/\/([^\/]+)/i.exec(url);
      if (!m) errors.push('The broker address must be a full web address starting with https://');
      else if (m[1].toLowerCase() !== 'https') errors.push('The broker address must use https:// (never plain http).');
      else if (!/(^|\.)script\.google\.com$|(^|\.)googleusercontent\.com$/i.test(m[2]))
        warnings.push('That address is not a script.google.com / googleusercontent.com address — an Apps Script deployment URL is expected (see the deploy guide).');
    }
    if (!secret) errors.push('The shared secret is required (set when the broker was deployed — Script Properties, HMAC_SECRET).');
    else if (secret.length < 16) warnings.push('That secret is short (' + secret.length + ' characters). The deploy guide generates 32+ — double-check you pasted the whole value.');
    return { ok: errors.length === 0, errors: errors, warnings: warnings, url: url, secret: secret };
  }

  function deviceSlug(label) {
    var s = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'device';
  }

  /* Export bundles are named so the operator CLI recognises them by name
     alone (bootstrap-core KIND_BY_NAME → kind 'master-snapshot'). */
  function exportFileName(deviceLabel, isoDate) {
    var d = String(isoDate || '').slice(0, 10) || 'undated';
    return 'master-snapshot.' + deviceSlug(deviceLabel) + '.' + d + '.json';
  }

  /* Collect { key → raw string } from either store shape: CESTISStore
     (keys()/getItem) or a bare DOM Storage (length/key(i)/getItem). */
  function storeMapFrom(store) {
    var map = {};
    if (!store) return map;
    var keys = [];
    if (typeof store.keys === 'function') keys = store.keys();
    else if (typeof store.length === 'number' && typeof store.key === 'function') {
      for (var i = 0; i < store.length; i++) keys.push(store.key(i));
    }
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      if (k == null) continue;
      try { var v = store.getItem(k); if (v != null) map[k] = v; } catch (e) { /* unreadable key: skip, never abort the export */ }
    }
    return map;
  }

  function readBrokerConfig(adapter) { return adapter.get(CONFIG_NS, CONFIG_KEY); }
  /* Re-saving url/secret must never silently flip cutover state: the
     enforced flag is preserved from whatever is already stored. */
  function writeBrokerConfig(adapter, next) {
    return adapter.get(CONFIG_NS, CONFIG_KEY).then(function (prev) {
      var cfg = { url: String(next.url || '').trim(), secret: String(next.secret || '').trim(), enforced: !!(prev && prev.enforced) };
      return adapter.put(CONFIG_NS, CONFIG_KEY, cfg).then(function () { return cfg; });
    });
  }
  function clearBrokerConfig(adapter) { return adapter.del(CONFIG_NS, CONFIG_KEY); }

  /* One call the page's "Test connection" button makes: is the broker
     reachable with THIS url+secret, and where does it stand? Never throws. */
  function probeBroker(client) {
    return client.headq().then(function (head) {
      return client.gate({ op: 'get' }).then(function (g) {
        return { ok: true, head: head, bootstrap: (g && g.gates && g.gates.bootstrap) || 'not sealed' };
      });
    }).catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
  }

  /* Operator-facing one-liner for what this device would do right now. */
  function describeBoot(boot) {
    if (!boot) return 'Status unknown — the check did not run.';
    if (boot.mode === 'enforced') return 'ENFORCED — this device runs fully on MegaData; legacy storage is closed.';
    if (boot.mode === 'shadow') return 'SHADOW — MegaData is live on this device and the legacy pages are being mirrored and compared.';
    if (boot.reason && /not sealed/i.test(boot.reason)) return 'LEGACY — connected to the broker, but the one-time data migration has not been run yet, so pages stay exactly as today.';
    if (boot.reason) return 'LEGACY — broker configured but not reachable right now (' + boot.reason + '). Pages stay exactly as today.';
    return 'LEGACY — no broker set up on this device yet. Pages behave exactly as they always have.';
  }

  return {
    ADMIN_CONFIG_NS: CONFIG_NS,
    ADMIN_CONFIG_KEY: CONFIG_KEY,
    validateBrokerSettings: validateBrokerSettings,
    deviceSlug: deviceSlug,
    exportFileName: exportFileName,
    storeMapFrom: storeMapFrom,
    readBrokerConfig: readBrokerConfig,
    writeBrokerConfig: writeBrokerConfig,
    clearBrokerConfig: clearBrokerConfig,
    probeBroker: probeBroker,
    describeBoot: describeBoot
  };
});
