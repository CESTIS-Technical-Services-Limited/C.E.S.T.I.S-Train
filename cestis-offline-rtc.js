/* ============================================================================
   cestis-offline-rtc.js — point video calls at the Centre's own server.

   The conference code creates connections with `new Peer(id, options)`. Left
   alone, the PeerJS library sends those introductions to a public server on the
   internet, which is why video was the one part of the system that could not
   work offline.

   This wraps the constructor so every call made from this folder is introduced
   by cestis-offline-server.js instead — the machine the pages are already being
   served from. Nothing in the conference code changes; it does not know or care
   which server made the introduction.

   ICE SERVERS
   -----------
   The online build lists Google's STUN servers and a public relay. Those exist
   to get two browsers through the public internet to each other. On one local
   network neither is reachable OR needed: browsers find each other directly by
   their addresses on that network. The list is emptied here, because a browser
   asked for an unreachable STUN server waits for it to time out before trying
   what would have worked immediately — the call takes far longer to start, or
   gives up.

   This file is loaded by BOTH builds. It changes nothing at all unless the
   page was served by the Centre's own server (the Offline System answers
   /_cestis/health): only then is the constructor wrapped. Online — GitHub
   Pages, or these pages opened straight off a memory stick — window.Peer is
   left exactly as the library made it. Connections are only ever made on a
   deliberate action (Start Class, Join, a chat call), long after the answer
   has come back, so the wrap is always in place before it is needed.
   ============================================================================ */
(function (root) {
  'use strict';

  if (root.__cestisRtcWrapped) return;          // only ever wrap once

  /* Ask whether this is the Centre's server. The page-cloud module asks the
     same question for the shared store, so reuse its answer when it is here. */
  function probe() {
    try {
      if (root.CESTISPageCloud && typeof root.CESTISPageCloud.lan === 'function') return root.CESTISPageCloud.lan();
      var loc = root.location;
      if (!root.fetch || !loc || !/^https?:$/.test(loc.protocol || '') || /\.github\.io$/i.test(loc.hostname || '')) {
        return Promise.resolve(false);
      }
      return root.fetch('/_cestis/health', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return !!(d && d.ok && d.mode === 'offline-lan'); })
        .catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  function localOptions(opts) {
    var out = {};
    // Keep anything the caller set that is not about WHERE to connect.
    Object.keys(opts || {}).forEach(function (k) {
      if (k !== 'host' && k !== 'port' && k !== 'path' && k !== 'secure' && k !== 'config') out[k] = opts[k];
    });
    out.host = root.location.hostname;
    out.port = Number(root.location.port) || (root.location.protocol === 'https:' ? 443 : 80);
    out.path = '/peerjs';
    out.secure = root.location.protocol === 'https:';
    // Same network: direct addresses only. See the note at the top.
    out.config = { iceServers: [] };
    return out;
  }

  function wrap() {
    if (!root.Peer || root.__cestisRtcWrapped) return;   // library missing, or done already
    root.__cestisRtcWrapped = true;
    var Original = root.Peer;
    function CestisPeer(id, opts) {
      // PeerJS accepts (options) alone as well as (id, options).
      if (id && typeof id === 'object' && opts === undefined) return new Original(localOptions(id));
      return new Original(id, localOptions(opts));
    }
    CestisPeer.prototype = Original.prototype;
    // Anything the library hangs off the constructor stays reachable.
    Object.keys(Original).forEach(function (k) {
      try { CestisPeer[k] = Original[k]; } catch (e) {}
    });
    root.Peer = CestisPeer;
    root.__cestisPeerOriginal = Original;
    if (root.console) console.log('[CESTIS] Video classes will be introduced by this Centre\'s own server \u2014 no internet needed.');
  }

  var offline = false;
  root.__cestisRtcIsOffline = function () { return offline; };
  probe().then(function (on) { offline = !!on; if (offline) wrap(); }, function () {});

})(typeof window !== 'undefined' ? window : this);
