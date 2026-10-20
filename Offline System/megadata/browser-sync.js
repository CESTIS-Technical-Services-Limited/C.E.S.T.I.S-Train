/* MegaData — browser sync glue (Phase 5 step 7; docs/02 §1, §11).
   Per device: ONE leader tab (Web Locks — auto-released on tab death) runs the
   broker sync; every tab shares the IndexedDB replica; BroadcastChannel
   carries "head advanced" so non-leader tabs re-open their DAL state.
   Browser-only by nature; exercised by the Playwright suite (Phase 6).

   Usage (per page, after the DAL is created over IdbAdapter + broker client):
     MegaData.startBrowserSync({ dal, onChange, intervalMs })            */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MegaData = Object.assign(root.MegaData || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function startBrowserSync(cfg) {
    var dal = cfg.dal;
    var intervalMs = cfg.intervalMs || 25000;   // visibility-gated poll (docs/02 §9)
    var onChange = cfg.onChange || function () {};
    var chanName = cfg.channel || 'cestis-mega';
    var stopped = false;
    var chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(chanName) : null;
    var lastSeen = dal.head().seq;

    if (chan) chan.onmessage = function (m) {
      if (m.data && m.data.type === 'head' && m.data.seq > lastSeen) {
        lastSeen = m.data.seq;
        onChange({ reason: 'broadcast', head: m.data });
      }
    };

    function announce() {
      var h = dal.head();
      if (chan && h.seq > lastSeen) { lastSeen = h.seq; chan.postMessage({ type: 'head', seq: h.seq, chain: h.chain }); }
    }

    function leaderLoop(lock) {
      function tick() {
        if (stopped) return Promise.resolve();
        var visible = typeof document === 'undefined' || document.visibilityState === 'visible';
        var due = dal.head().unsynced > 0 || visible;
        var p = due ? dal.sync.now().then(function () { announce(); onChange({ reason: 'sync', head: dal.head() }); })
                    .catch(function (e) { onChange({ reason: 'sync-error', error: String(e.message) }); })
                  : Promise.resolve();
        return p.then(function () {
          return new Promise(function (r) { setTimeout(r, intervalMs); }).then(tick);
        });
      }
      return tick();
    }

    // Web Locks: exactly one leader per device; the promise held open IS the
    // leadership; tab death releases it and another tab takes over.
    if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
      navigator.locks.request('cestis-mega-leader', function (lock) { return leaderLoop(lock); });
    } else {
      leaderLoop(null); // ancient browser: every tab syncs; broker dedupe keeps it safe
    }

    // Non-leader tabs still flush on pagehide so an accepted write reaches the
    // outbox store before the tab dies (the outbox itself is already durable).
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', function () { try { announce(); } catch (e) {} });
    }

    return { stop: function () { stopped = true; if (chan) chan.close(); } };
  }

  return { startBrowserSync: startBrowserSync };
});
