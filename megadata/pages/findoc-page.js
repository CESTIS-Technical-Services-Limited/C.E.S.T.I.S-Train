/* MegaData — Finance.Invoice / Finance.Quote / Finance.Purchase.Order
   integration (browser-only; one glue for all three — the shared FinanceDoc
   engine drives them, so one wrap covers every page). Saves become
   findoc.issued/superseded, deletions findoc.voided, remote changes apply
   into the legacy list the engine renders (via its own storage; the engine
   reloads on init and after our storage write we re-render through its
   public API where present). Numbers stay page-minted and PRESERVED until
   the enforced stage; __findocReconcile() reports duplicate numbers. */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var BY_PATH = [
    { re: /Finance\.Invoice\.html/i, page: 'Finance.Invoice', kind: 'invoice', storageKey: 'cestis_finance_invoices' },
    { re: /Finance\.Quote\.html/i, page: 'Finance.Quote', kind: 'quote', storageKey: 'cestis_finance_quotes' },
    { re: /Finance\.Purchase\.Order\.html/i, page: 'Finance.Purchase.Order', kind: 'po', storageKey: 'cestis_finance_pos' }
  ];

  window.addEventListener('DOMContentLoaded', function () {
    var MG = window.MegaData;
    if (!MG || !MG.pageBoot || !MG.fdPlan) return;
    var here = String(window.location.pathname || '');
    var CFG = BY_PATH.filter(function (c) { return c.re.test(here); })[0];
    if (!CFG) return;
    var ALLOW = [
      CFG.storageKey, 'cestis_finance_convert', 'cestis_fin_logo', 'cestis_active_quarter',
      'cestis_pagecloud_stamps__', 'schoolDashboardGoogle', 'cestisGoogle', 'darkMode'
    ];

    function readDocs() {
      try { var v = JSON.parse(window.CESTISStore.getItem(CFG.storageKey) || 'null'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
    }

    MG.pageBoot({
      page: CFG.page,
      actor: { name: CFG.page, role: 'admin', device: 'dev_browser' },
      allow: ALLOW,
      onChange: function () { if (window.__fdTick) window.__fdTick(); }
    }).then(function (BOOT) {
      if (BOOT.mode === 'legacy') {
        if (BOOT.reason) console.info('[MegaData] ' + CFG.page + ' legacy mode: ' + BOOT.reason);
        return;
      }
      var dal = BOOT.dal, adapter = BOOT.adapter;
      console.info('[MegaData] ' + CFG.page + ' findoc bridge active (' + BOOT.mode + '), head seq ' + dal.head().seq);

      var applying = false;
      var tick = Promise.resolve();

      function runTick() {
        tick = tick.then(function () {
          return adapter.get('meta', 'fdBaseline:' + CFG.kind).then(function (baseline) {
            var local = readDocs();
            return MG.fdPlan(dal, CFG.kind, local, baseline || {}).then(function (plan) {
              return MG.fdPush(dal, plan, CFG.page).then(function () {
                return dal.sync.now().catch(function (e) { console.info('[MegaData] sync deferred: ' + e.message); });
              }).then(function () {
                if (plan.conflicts.length) console.warn('[MegaData] ' + CFG.page + ': ' + plan.conflicts.length + ' both-changed field(s), local pushed as last writer', plan.conflicts);
                var res = MG.fdApply(local, plan);
                if (res.changed) {
                  applying = true;
                  try {
                    window.CESTISStore.setItem(CFG.storageKey, JSON.stringify(res.records));
                    // The engine keeps its list in a closure; its init-time
                    // loader re-reads storage. Re-rendering through the
                    // public API is best-effort and safe to skip.
                    if (window.FinanceDoc && typeof window.FinanceDoc.init === 'function' && window.__fdReinit) { try { window.__fdReinit(); } catch (e) {} }
                  } finally { applying = false; }
                  console.info('[MegaData] ' + CFG.page + ' mirror applied to storage (list refreshes on reload)');
                }
                return adapter.put('meta', 'fdBaseline:' + CFG.kind, plan.newBaseline);
              });
            });
          }).catch(function (e) { console.warn('[MegaData] findoc tick: ' + e.message); });
        });
        return tick;
      }

      if (window.FinanceDoc) {
        ['saveDoc', 'deleteDoc', 'duplicateDoc'].forEach(function (fn) {
          var orig = window.FinanceDoc[fn];
          if (typeof orig !== 'function') return;
          window.FinanceDoc[fn] = function () {
            var r = orig.apply(this, arguments);
            if (!applying) runTick();
            return r;
          };
        });
      }

      window.__fdTick = runTick;
      window.__findocReconcile = function () {
        var rep = MG.findocReconcile(dal, [CFG.kind]);
        console.info('[MegaData] ' + CFG.kind + ' numbers: ' + (rep.ok ? 'no duplicates' : rep.duplicates.length + ' duplicate number(s) — human review'), rep.duplicates);
        return rep;
      };

      runTick();
      window.addEventListener('storage', function (e) {
        if (e.key === CFG.storageKey) runTick();
      });
    }).catch(function (e) { console.warn('[MegaData] boot failed, staying legacy: ' + e.message); });
  });
})();
