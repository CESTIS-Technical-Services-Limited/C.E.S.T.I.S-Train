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

  /* HOST PLACES. A class room's host is the peer  cestis-<ROOMCODE>-host,
     and the Centre's server used to give that id to whoever asked first — a
     trainee who knew the room code could take the class's host place before
     the instructor arrived. The server now accepts a host id only with a HOST
     TICKET, which it gives to a member of staff when they sign in (it checks
     their password itself: /_cestis/host-ticket in cestis-offline-server.js).
     The ticket is kept for this browser tab only, and only for the person it
     was issued to. */
  var TICKET_KEY = 'cestisLanHostTicket';
  var STAFF = { admin: 1, adminstaff: 1, instructor: 1 };
  function hostTicketFor(id) {
    if (!/^cestis-[A-Za-z0-9]+-host$/.test(String(id || ''))) return '';
    try {
      var t = JSON.parse(root.sessionStorage.getItem(TICKET_KEY) || 'null');
      var me = root.currentLoggedInUser;
      if (t && t.ticket && me && t.uid === me.id && Date.now() < Number(t.exp || 0)) return String(t.ticket);
    } catch (e) {}
    return '';
  }
  // The passwords published with the platform. The server refuses them
  // outright (a 403, logged by the browser as an error), so they are never sent.
  function publishedDefault(pw) {
    try { return !!(root.CESTISCore && root.CESTISCore.accountAccess.isPublishedDefault(pw)); } catch (e) { return false; }
  }
  root.cestisLanHostTicket = function (account, password) {
    if (!account || !password || !STAFF[String(account.role || '').trim().toLowerCase()] || !root.fetch) return Promise.resolve(false);
    if (publishedDefault(password)) return Promise.resolve(false);
    return probe().then(function (on) {
      if (!on) return false;
      return root.fetch('/_cestis/token', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.token) return null;
          return root.fetch('/_cestis/host-ticket', {
            method: 'POST', cache: 'no-store',
            headers: { 'Content-Type': 'application/json', 'X-CESTIS-Token': String(d.token) },
            body: JSON.stringify({ username: account.username || account.email || '', password: String(password) })
          });
        })
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.ticket) return false;
          root.sessionStorage.setItem(TICKET_KEY, JSON.stringify({ uid: account.id, ticket: String(j.ticket), exp: Number(j.expires) || 0 }));
          return true;
        });
    }).catch(function () { return false; });
  };

  function localOptions(opts, id) {
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
    // A host id goes with this tab's host ticket (PeerJS sends the "key" with
    // its first request; the Centre's server reads the ticket from there).
    var ticket = hostTicketFor(id);
    if (ticket) out.key = ticket;
    return out;
  }

  function wrap() {
    if (!root.Peer || root.__cestisRtcWrapped) return;   // library missing, or done already
    root.__cestisRtcWrapped = true;
    var Original = root.Peer;
    function CestisPeer(id, opts) {
      // PeerJS accepts (options) alone as well as (id, options).
      if (id && typeof id === 'object' && opts === undefined) return new Original(localOptions(id, null));
      return new Original(id, localOptions(opts, id));
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
