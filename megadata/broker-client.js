/* MegaData — HTTP client for the broker (Phase 5 step 7).
   Speaks the Apps Script web-app dialect: POST with text/plain content type
   (a "simple request" — Apps Script cannot answer CORS preflights), body =
   JSON {op, auth, payload}. auth = sha256(secret | canon(payload)) — the
   shared-secret HMAC accepted as a known weakness under D1; the secret is
   NEVER committed (public repo, D3): an admin enters it once per device and
   it lives in local meta, excluded from every sync and export.
   Retries: network errors and 429/5xx back off exponentially (injectable
   sleep for tests); replayed appends are safe because the broker answers
   duplicate event ids with their original acks (P10). */
(function (root, factory) {
  var MD = (typeof module !== 'undefined' && module.exports) ? require('./schemas.js') : root.MegaData;
  var api = factory(MD);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MegaData = Object.assign(root.MegaData || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function (MD) {
  'use strict';

  function createBrokerClient(cfg) {
    var url = cfg.url, secret = cfg.secret || '';
    var fetchImpl = cfg.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    var sleep = cfg.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var maxRetries = cfg.maxRetries != null ? cfg.maxRetries : 4;
    if (!fetchImpl) throw new Error('no fetch implementation available');

    function call(op, payload) {
      return MD.sha256Hex(secret + '|' + MD.canon(payload || {})).then(function (auth) {
        var body = JSON.stringify({ op: op, auth: auth, payload: payload || {} });
        var attempt = 0;
        function go() {
          return fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // simple request: no preflight
            redirect: 'follow',                                      // Apps Script 302s to googleusercontent
            body: body
          }).then(function (res) {
            if (res.status === 429 || res.status >= 500) { var e = new Error('HTTP ' + res.status); e.retryable = true; throw e; }
            return res.text().then(function (t) {
              var parsed;
              try { parsed = JSON.parse(t); } catch (e2) { throw new Error('broker returned non-JSON (' + res.status + '): ' + t.slice(0, 120)); }
              if (parsed && parsed.error) { var be = new Error('broker: ' + parsed.error); be.broker = true; throw be; }
              return parsed;
            });
          }).catch(function (err) {
            var retryable = err.retryable || (!err.broker && /fetch|network|ECONN|ETIMEDOUT/i.test(String(err.message)));
            if (retryable && attempt < maxRetries) {
              attempt++;
              return sleep(Math.pow(2, attempt) * 1000).then(go);   // 2s, 4s, 8s, 16s
            }
            throw err;
          });
        }
        return go();
      });
    }

    return {
      append: function (req) { return call('append', req); },
      pull: function (req) { return call('pull', req); },
      headq: function () { return call('headq', {}); },
      gate: function (req) { return call('gate', req); },
      _call: call
    };
  }

  return { createBrokerClient: createBrokerClient };
});
