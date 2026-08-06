/* MegaData — DAL-bypass enforcement shim (Phase 5 step 7; docs/02 §12).
   A first-loaded script patches Storage.prototype methods, indexedDB.open and
   googleapis fetches so that legacy-storage access outside the DAL is LOGGED
   (report mode, during migration) or THROWN (enforced mode, at cutover).
   The per-page mode map IS the migration progress report (spec §7 constraint),
   and "silent-write register is empty" (spec 6.3) is operationally defined as
   zero shim violations across the Playwright suite in throw mode.
   The decision logic is pure (Node-tested); install() is browser-only. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MegaData = Object.assign(root.MegaData || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Keys the DAL/glue itself legitimately touches, on every page.
  var DAL_PREFIXES = ['cestis_mega_', '__cestisShim'];

  function createShimPolicy(cfg) {
    cfg = cfg || {};
    var mode = cfg.mode || 'report';                    // 'off' | 'report' | 'throw'
    var page = cfg.page || 'unknown';
    var allow = (cfg.allow || []).concat(DAL_PREFIXES); // page-specific allowlist, shrinks to [] by cutover
    var violations = [];
    function allowed(key) {
      key = String(key == null ? '' : key);
      for (var i = 0; i < allow.length; i++) if (key.indexOf(allow[i]) === 0) return true;
      return false;
    }
    return {
      mode: mode, page: page, violations: violations,
      decide: function (api, op, key) {
        if (mode === 'off' || allowed(key)) return 'allow';
        var v = { page: page, api: api, op: op, key: String(key == null ? '' : key), at: new Date().toISOString() };
        violations.push(v);
        return mode === 'throw' ? 'throw' : 'report';
      }
    };
  }

  function installShim(policy, w) {
    w = w || (typeof window !== 'undefined' ? window : null);
    if (!w) throw new Error('installShim is browser-only');
    var origs = {
      setItem: Storage.prototype.setItem, getItem: Storage.prototype.getItem,
      removeItem: Storage.prototype.removeItem, idbOpen: w.indexedDB && w.indexedDB.open,
      fetch: w.fetch
    };
    function guard(api, op, key, fn, args, self) {
      var d = policy.decide(api, op, key);
      if (d === 'throw') {
        var err = new Error('DAL bypass (' + api + '.' + op + ' "' + key + '") on ' + policy.page + ' — use CESTISData');
        try { w.dispatchEvent(new CustomEvent('cestis-shim-violation', { detail: policy.violations[policy.violations.length - 1] })); } catch (e) {}
        throw err;
      }
      if (d === 'report') {
        try { w.dispatchEvent(new CustomEvent('cestis-shim-violation', { detail: policy.violations[policy.violations.length - 1] })); } catch (e) {}
      }
      return fn.apply(self, args);
    }
    Storage.prototype.setItem = function (k, v) { return guard('storage', 'setItem', k, origs.setItem, [k, v], this); };
    Storage.prototype.getItem = function (k) { return guard('storage', 'getItem', k, origs.getItem, [k], this); };
    Storage.prototype.removeItem = function (k) { return guard('storage', 'removeItem', k, origs.removeItem, [k], this); };
    if (origs.idbOpen) {
      w.indexedDB.open = function (name, ver) {
        if (name !== 'CESTIS_MEGA') {
          var d = policy.decide('indexedDB', 'open', name);
          if (d === 'throw') throw new Error('DAL bypass (indexedDB.open "' + name + '") on ' + policy.page);
        }
        return origs.idbOpen.call(w.indexedDB, name, ver);
      };
    }
    if (origs.fetch) {
      w.fetch = function (input, init) {
        var u = typeof input === 'string' ? input : (input && input.url) || '';
        if (/googleapis\.com/.test(u)) {
          var d = policy.decide('fetch', 'googleapis', u);
          if (d === 'throw') return Promise.reject(new Error('DAL bypass (direct googleapis fetch) on ' + policy.page));
        }
        return origs.fetch.call(w, input, init);
      };
    }
    w.__cestisShim = policy;
    return { uninstall: function () {
      Storage.prototype.setItem = origs.setItem; Storage.prototype.getItem = origs.getItem;
      Storage.prototype.removeItem = origs.removeItem;
      if (origs.idbOpen) w.indexedDB.open = origs.idbOpen;
      if (origs.fetch) w.fetch = origs.fetch;
    } };
  }

  return { createShimPolicy: createShimPolicy, installShim: installShim };
});
