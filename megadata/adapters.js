/* MegaData — storage adapters behind one interface (Phase 5 step 2).
   Interface (all async): get(ns,k) put(ns,k,v) del(ns,k) scan(ns) → [{k,v}].
   MemoryAdapter: Node tests + in-page cache. FileAdapter: migration CLI staging.
   The IndexedDB adapter ships with the browser glue (step 7) behind this same
   interface — anything proven against these adapters holds there by contract. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MegaData = Object.assign(root.MegaData || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function MemoryAdapter() {
    var spaces = new Map();
    function ns(name) { if (!spaces.has(name)) spaces.set(name, new Map()); return spaces.get(name); }
    return {
      kind: 'memory',
      get: function (n, k) { return Promise.resolve(ns(n).has(k) ? ns(n).get(k) : null); },
      put: function (n, k, v) { ns(n).set(k, v); return Promise.resolve(); },
      del: function (n, k) { ns(n).delete(k); return Promise.resolve(); },
      scan: function (n) {
        return Promise.resolve(Array.from(ns(n).entries()).map(function (e) { return { k: e[0], v: e[1] }; }));
      }
    };
  }

  function FileAdapter(dir) { // Node only; one JSON file per namespace.
    var fs = require('fs'), path = require('path');
    function file(n) { return path.join(dir, n + '.json'); }
    function load(n) {
      try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch (e) { return {}; }
    }
    function save(n, obj) {
      fs.mkdirSync(dir, { recursive: true });
      var tmp = file(n) + '.tmp.' + process.pid + '.' + Math.floor(Math.random() * 1e9);
      fs.writeFileSync(tmp, JSON.stringify(obj)); // unique tmp name: no L22 repeat
      fs.renameSync(tmp, file(n));
    }
    return {
      kind: 'file',
      get: function (n, k) { var o = load(n); return Promise.resolve(k in o ? o[k] : null); },
      put: function (n, k, v) { var o = load(n); o[k] = v; save(n, o); return Promise.resolve(); },
      del: function (n, k) { var o = load(n); delete o[k]; save(n, o); return Promise.resolve(); },
      scan: function (n) {
        var o = load(n);
        return Promise.resolve(Object.keys(o).map(function (k) { return { k: k, v: o[k] }; }));
      }
    };
  }

  return { MemoryAdapter: MemoryAdapter, FileAdapter: FileAdapter };
});
