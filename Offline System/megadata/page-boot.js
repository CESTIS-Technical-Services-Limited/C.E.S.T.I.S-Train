/* MegaData — shared page bootstrap (browser; the pattern every refactored
   page uses — docs/02 §12, §14).

   Modes (resolved at load, never guessed):
     'legacy'  — MegaData not configured or bootstrap not sealed: the page
                 behaves exactly as today; the shim runs in REPORT mode only,
                 quietly building the bypass telemetry.
     'shadow'  — broker configured + bootstrap sealed: the DAL is primary,
                 the page mirrors its owned keys back to legacy storage for
                 unrefactored pages, comparator runs (docs/04 §8).
     'enforced'— cutover: shim throws on any legacy access outside the
                 allowlist (which is empty by then).

   Broker config { url, secret } is entered once per device by an admin and
   lives ONLY in the local meta store — never in the repo (D3), never synced. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MegaData = Object.assign(root.MegaData || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function pageBoot(cfg) {
    var MG = (typeof window !== 'undefined' ? window : globalThis).MegaData;
    var page = cfg.page, actor = cfg.actor || { name: 'Unknown', role: 'admin', device: 'dev_unknown' };
    var shim = MG.createShimPolicy({ mode: cfg.shimMode || 'report', page: page, allow: cfg.allow || [] });
    try { MG.installShim(shim); } catch (e) { /* non-browser or already installed */ }

    var adapter = MG.IdbAdapter();
    return adapter.get('meta', 'brokerConfig').then(function (bc) {
      if (!bc || !bc.url || !bc.secret) return { mode: 'legacy', shim: shim, adapter: adapter, saveBrokerConfig: saveCfg };
      var client = MG.createBrokerClient({ url: bc.url, secret: bc.secret });
      return client.gate({ op: 'get' }).then(function (g) {
        if (!g || !g.gates || g.gates.bootstrap !== 'sealed') {
          return { mode: 'legacy', reason: 'bootstrap not sealed', shim: shim, adapter: adapter, saveBrokerConfig: saveCfg };
        }
        return MG.createDAL({ adapter: adapter, broker: client, actor: actor, source: page }).then(function (dal) {
          var sync = MG.startBrowserSync({ dal: dal, onChange: cfg.onChange || function () {} });
          return { mode: bc.enforced ? 'enforced' : 'shadow', dal: dal, sync: sync, shim: shim, adapter: adapter, saveBrokerConfig: saveCfg };
        });
      }).catch(function (e) {
        // Broker unreachable: pages that already hold a replica could open
        // offline-first; the PILOT keeps it simple — legacy mode + a note.
        return { mode: 'legacy', reason: 'broker unreachable: ' + e.message, shim: shim, adapter: adapter, saveBrokerConfig: saveCfg };
      });
      function saveCfg(next) { return adapter.put('meta', 'brokerConfig', next); }
    });
  }

  return { pageBoot: pageBoot };
});
