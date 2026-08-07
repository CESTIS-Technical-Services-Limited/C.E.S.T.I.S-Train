/* MegaData — Finance.Payment.Voucher integration (browser-only). Vouchers
   themselves are DERIVED from cashbook payments (that book already bridges);
   this page persists only its per-payment overrides map, which syncs as
   docsync docs (kind 'voucherOverride', keys pinned to the bootstrap
   extractor). The map key rides inside the record as __k so canonical docs
   can name their local slot; bootstrap-imported overrides (no __k) sync
   one-way until first touched locally, then join fully — noted, not hidden. */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  window.addEventListener('DOMContentLoaded', function () {
    var MG = window.MegaData;
    if (!MG || !MG.pageBoot || !MG.docSyncPlan) return;
    var PAGE = 'Finance.Payment.Voucher';
    var KEY = 'cestis_finance_voucher_overrides';
    var SPEC = {
      kind: 'voucherOverride',
      bootKey: function (r) { return 'voucherOverride|' + r.__k; },
      localId: function (f) { return f.__k == null ? '' : String(f.__k); },
      fromDoc: function (f) {
        var o = {};
        Object.keys(f || {}).forEach(function (k) { if (k !== '_removed' && k !== 'docKind') o[k] = f[k]; });
        return o;
      }
    };
    var ALLOW = [KEY, 'cestis_quarter_', 'cestis_active_quarter', 'cestis_fin_logo', 'cestis_pagecloud_stamps__', 'schoolDashboardGoogle', 'darkMode'];

    function mapToList(map) {
      return Object.keys(map || {}).map(function (k) {
        var v = map[k];
        var rec = (v && typeof v === 'object') ? Object.assign({}, v) : { value: v };
        rec.__k = k;
        return rec;
      });
    }
    function listToMap(list) {
      var out = {};
      (list || []).forEach(function (r) {
        if (!r || r.__k == null || r.__k === '') return;
        var v = Object.assign({}, r);
        delete v.__k;
        out[r.__k] = ('value' in v && Object.keys(v).length === 1) ? v.value : v;
      });
      return out;
    }
    function readMap() {
      try { return JSON.parse(window.CESTISStore.getItem(KEY) || 'null') || {}; } catch (e) { return {}; }
    }

    MG.pageBoot({
      page: PAGE,
      actor: { name: 'Voucher', role: 'admin', device: 'dev_browser' },
      allow: ALLOW,
      onChange: function () { if (window.__voucherTick) window.__voucherTick(); }
    }).then(function (BOOT) {
      if (BOOT.mode === 'legacy') {
        if (BOOT.reason) console.info('[MegaData] ' + PAGE + ' legacy mode: ' + BOOT.reason);
        return;
      }
      var dal = BOOT.dal, adapter = BOOT.adapter;
      console.info('[MegaData] ' + PAGE + ' docsync active (' + BOOT.mode + '), head seq ' + dal.head().seq);

      var applying = false;
      var tick = Promise.resolve();

      function runTick() {
        tick = tick.then(function () {
          return adapter.get('meta', 'voucherBaseline').then(function (baseline) {
            var local = mapToList(readMap()).filter(function (r) { return r.__k; });
            return MG.docSyncPlan(dal, SPEC, local, baseline || {}).then(function (plan) {
              // Canonical docs without __k cannot name a local slot: skip
              // their mirror-in explicitly (they join on first local touch).
              plan.newLocal = plan.newLocal.filter(function (r) { return r.__k != null && r.__k !== ''; });
              return MG.docSyncPush(dal, plan, PAGE).then(function () {
                return dal.sync.now().catch(function (e) { console.info('[MegaData] sync deferred: ' + e.message); });
              }).then(function () {
                if (plan.conflicts.length) console.warn('[MegaData] ' + PAGE + ': ' + plan.conflicts.length + ' both-changed field(s), local pushed as last writer', plan.conflicts);
                var res = MG.docSyncApply(SPEC, local, plan);
                if (res.changed) {
                  applying = true;
                  try { window.CESTISStore.setItem(KEY, JSON.stringify(listToMap(res.records))); }
                  finally { applying = false; }
                  console.info('[MegaData] ' + PAGE + ' mirror applied');
                }
                return adapter.put('meta', 'voucherBaseline', plan.newBaseline);
              });
            });
          }).catch(function (e) { console.warn('[MegaData] voucher tick: ' + e.message); });
        });
        return tick;
      }

      // The page writes the overrides map through CESTISStore.setItem in a
      // few places; the storage listener catches other tabs, and this wrap
      // catches this one: saveOverrides-equivalents all funnel through
      // setItem on OUR key, so wrap the store's setItem narrowly.
      var origSet = window.CESTISStore.setItem;
      window.CESTISStore.setItem = function (k, v) {
        var r = origSet.apply(this, arguments);
        if (!applying && k === KEY && window.__voucherTick) window.__voucherTick();
        return r;
      };

      window.__voucherTick = runTick;
      runTick();
      window.addEventListener('storage', function (e) {
        if (e.key === KEY) runTick();
      });
    }).catch(function (e) { console.warn('[MegaData] boot failed, staying legacy: ' + e.message); });
  });
})();
