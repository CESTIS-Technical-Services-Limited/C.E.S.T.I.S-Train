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

   If the offline server is not answering (someone opened these pages straight
   off a memory stick), the original behaviour is left completely alone, so the
   same folder still works normally on a machine that is online.
   ============================================================================ */
(function (root) {
  'use strict';

  if (!root.Peer) return;                       // library missing; nothing to wrap
  if (root.__cestisRtcWrapped) return;          // only ever wrap once
  root.__cestisRtcWrapped = true;

  var Original = root.Peer;
  var offline = false;                          // decided by the probe below

  /* Ask the server whether it is ours. Runs once, at load, long before anybody
     clicks "Start Class" — connections are only made on a deliberate action. */
  try {
    root.fetch('/_cestis/health', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        offline = !!(d && d.ok && d.mode === 'offline-lan');
        if (offline && root.console) {
          console.log('[CESTIS] Video classes will be introduced by this Centre\'s own server — no internet needed.');
        }
      })
      .catch(function () { offline = false; });
  } catch (e) { offline = false; }

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

  function CestisPeer(id, opts) {
    if (!offline) return new Original(id, opts);
    return new Original(id, localOptions(opts));
  }
  CestisPeer.prototype = Original.prototype;
  // Anything the library hangs off the constructor stays reachable.
  Object.keys(Original).forEach(function (k) {
    try { CestisPeer[k] = Original[k]; } catch (e) {}
  });

  root.Peer = CestisPeer;
  root.__cestisPeerOriginal = Original;
  root.__cestisRtcIsOffline = function () { return offline; };

})(typeof window !== 'undefined' ? window : this);
