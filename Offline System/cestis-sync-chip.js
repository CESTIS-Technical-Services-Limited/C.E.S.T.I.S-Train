/* ============================================================================
   cestis-sync-chip.js — the "is my work safe?" chip for the sibling pages
   (School Fee, Cashbook, Payroll, Clock-in, Virement, Income & Expenditure,
   the finance documents).

   WHY THIS EXISTS
   ---------------
   Each of these pages saves its records on the computer at once and sends
   them to the Centre's Google Drive (or, on the Centre's own network, its
   server) through cestis-page-cloud.js. Nothing on the page said whether that
   had happened: an expired Google sign-in, a dropped connection or a failing
   upload looked exactly like a page that was backed up — which is when a
   cleared browser or a swapped PC loses work.

   WHAT IT DOES
   ------------
   Shows one small chip where the page puts <span data-cestis-sync-chip>:
   "All saved", "Changes waiting", "Offline — saved on this device" or "Sign
   in to Google to back up" (the dashboard's own chip uses the same words —
   CESTISCore.ui.syncHealth decides them). Pressing it shows when this page
   last saved and what to do. It only READS what cestis-page-cloud.js already
   records (each page's write stamps, its last upload and last error), the
   Google sign-in the pages share, and the browser's online flag. It never
   saves, syncs or retries anything, and changes nothing that is stored.
   ============================================================================ */
(function (root) {
  'use strict';
  var doc = root.document;
  if (!doc) return;
  var TOKEN_KEY = 'schoolDashboardGoogleAccessToken';
  var EXPIRY_KEY = 'schoolDashboardGoogleTokenExpiry';
  var openedAt = Date.now();
  var lanOn = false;
  var errSeen = {};

  function store() { return root.CESTISStore || root.localStorage; }
  function cloud() { return root.CESTISPageCloud; }
  // The page-cloud stamps edits on its own clock (corrected towards Google's
  // or the Centre server's); its Drive uploads are dated by this device's.
  function clockSkew() {
    try { var n = Date.parse(cloud().now()); return isNaN(n) ? 0 : n - Date.now(); } catch (e) { return 0; }
  }

  function inputs() {
    var now = Date.now(), s = store(), pc = cloud();
    var tok = null, exp = 0;
    try { tok = s.getItem(TOKEN_KEY); exp = Date.parse(s.getItem(EXPIRY_KEY) || '') || 0; } catch (e) {}
    var pages = (pc && pc._pages) || [];
    var skew = clockSkew();
    var connected = !!tok && (!exp || exp > now);
    var online = root.navigator ? root.navigator.onLine !== false : true;
    var pendingSince = null, edited = false, failures = 0, last = 0, trouble = false;
    pages.forEach(function (p) {
      if (!p || !p.spec || p.spec.readOnly) return;
      var st = p.state || {};
      // The last moment this page and its file agreed: its last upload, or
      // its last read of the file.
      var agreed = Math.max(Date.parse(st.lastPush || '') || 0, Date.parse(st.lastPull || '') || 0);
      if (agreed > last) last = agreed;
      // A Drive upload's error stays on the page after a later upload goes
      // through; it counts only until the next successful one.
      var memo = errSeen[p.spec.file];
      if (!st.error) delete errSeen[p.spec.file];
      else if (!memo || memo.msg !== st.error) memo = errSeen[p.spec.file] = { msg: st.error, push: st.lastPush || '' };
      if (st.error && (st.backend === 'offline-server' || (st.lastPush || '') === memo.push)) {
        failures++;
        if (st.backend === 'offline-server') trouble = true;
      }
      // Edits made on this page since it was opened (page-cloud stamps every
      // one). While it is connected each goes up within seconds, so they only
      // matter when it cannot upload — and then no pull can stamp anything.
      var stamps = {};
      try { stamps = p.stamps() || {}; } catch (e) {}
      Object.keys(stamps).forEach(function (k) {
        if (k.charAt(0) === '_') return;
        var t = Date.parse(stamps[k] || '');
        if (!isNaN(t) && t > openedAt + skew + 1000) {
          edited = true;
          var local = t - skew;
          if (!pendingSince || local < pendingSince) pendingSince = local;
        }
      });
    });
    if (doc.getElementById('cestisLanTrouble')) trouble = true;
    var cannotUpload = lanOn ? trouble : (!online || !connected);
    return { now: now, online: online, lan: lanOn, lanTrouble: trouble, connected: connected, tokenExpiresAt: exp || null,
      pending: (cannotUpload && edited) || (!lanOn && connected && failures > 0),
      pendingSince: cannotUpload && edited ? pendingSince : null, failures: failures, lastSavedAt: last || null };
  }

  var CSS = '.cestis-sync-chip-wrap{position:relative;display:inline-block;vertical-align:middle;font-family:"DM Sans",system-ui,sans-serif}' +
    '.cestis-sync-chip{display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:20px;cursor:pointer;font:600 12px/1.2 "DM Sans",system-ui,sans-serif;' +
    'white-space:nowrap;background:rgba(12,17,23,.55);border:1px solid rgba(255,255,255,.18);color:#e8edf3}' +
    '.cestis-sync-chip:hover{background:rgba(12,17,23,.75)}' +
    '.cestis-sync-chip:focus-visible{outline:2px solid #f0a500;outline-offset:2px}' +
    '.cestis-sync-chip-dot{width:9px;height:9px;border-radius:50%;background:#8293a7;flex-shrink:0}' +
    '.cestis-sync-chip.tone-ok{border-color:rgba(46,204,113,.5)}.cestis-sync-chip.tone-ok .cestis-sync-chip-dot{background:#2ecc71;box-shadow:0 0 6px rgba(46,204,113,.6)}' +
    '.cestis-sync-chip.tone-warn{border-color:rgba(240,165,0,.6)}.cestis-sync-chip.tone-warn .cestis-sync-chip-dot{background:#f0a500}' +
    '.cestis-sync-chip.tone-bad{border-color:rgba(231,76,60,.7);background:rgba(120,30,20,.6)}.cestis-sync-chip.tone-bad .cestis-sync-chip-dot{background:#e74c3c}' +
    '.cestis-sync-chip-panel{position:absolute;right:0;top:calc(100% + 8px);width:290px;max-width:calc(100vw - 24px);z-index:100000;text-align:left;' +
    'background:#1a2332;border:1px solid rgba(255,255,255,.12);border-radius:8px;box-shadow:0 10px 25px rgba(0,0,0,.45);padding:13px 15px;' +
    'font:400 12.5px/1.45 "DM Sans",system-ui,sans-serif;color:#aab8c8;white-space:normal}' +
    '.cestis-sync-chip-panel[hidden]{display:none}' +
    '.cestis-sync-chip-panel b{display:block;color:#e8edf3;font-size:13.5px;margin-bottom:4px}' +
    '.cestis-sync-chip-panel .last{margin-top:8px;color:#e8edf3;font-weight:600}' +
    '.cestis-sync-chip-panel ul{margin:8px 0 0 16px;padding:0}.cestis-sync-chip-panel li{margin-top:4px}' +
    '@media (max-width:600px){.cestis-sync-chip-label{display:none}.cestis-sync-chip{padding:7px 9px}' +
    '.cestis-sync-chip-panel{position:fixed;left:12px;right:12px;top:64px;width:auto;max-width:none}}' +
    '@media print{.cestis-sync-chip-wrap{display:none!important}}';

  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function mount(slot) {
    if (slot.__chip) return slot.__chip;
    var wrap = el('span', 'cestis-sync-chip-wrap');
    var chip = el('button', 'cestis-sync-chip tone-warn');
    chip.type = 'button';
    chip.setAttribute('aria-expanded', 'false');
    var dot = el('span', 'cestis-sync-chip-dot'); dot.setAttribute('aria-hidden', 'true');
    var label = el('span', 'cestis-sync-chip-label', 'Checking…');
    chip.appendChild(dot); chip.appendChild(label);
    var panel = el('div', 'cestis-sync-chip-panel');
    panel.setAttribute('role', 'dialog');
    panel.hidden = true;
    var pid = 'cestisSyncChipPanel' + Math.random().toString(36).slice(2, 7);
    panel.id = pid; chip.setAttribute('aria-controls', pid);
    var title = el('b'), detail = el('div'), last = el('div', 'last'), list = el('ul');
    panel.appendChild(title); panel.appendChild(detail); panel.appendChild(last); panel.appendChild(list);
    wrap.appendChild(chip); wrap.appendChild(panel);
    slot.appendChild(wrap);
    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      render(slot.__chip);
      panel.hidden = !panel.hidden;
      chip.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
    });
    doc.addEventListener('click', function (e) {
      if (!panel.hidden && !wrap.contains(e.target)) { panel.hidden = true; chip.setAttribute('aria-expanded', 'false'); }
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) { panel.hidden = true; chip.setAttribute('aria-expanded', 'false'); chip.focus(); }
    });
    slot.__chip = { wrap: wrap, chip: chip, label: label, panel: panel, title: title, detail: detail, last: last, list: list };
    return slot.__chip;
  }

  function render(c) {
    var C = root.CESTISCore;
    if (!c || !C || !C.ui || typeof C.ui.syncHealth !== 'function' || !cloud()) return;
    var h = C.ui.syncHealth(inputs());
    c.chip.className = 'cestis-sync-chip tone-' + h.tone;
    c.chip.setAttribute('data-state', h.state);
    c.chip.setAttribute('aria-label', h.label + ' — show details');
    c.label.textContent = h.label;
    c.title.textContent = h.label;
    c.detail.textContent = h.detail;
    c.last.textContent = h.lastSaved;
    while (c.list.firstChild) c.list.removeChild(c.list.firstChild);
    h.advice.forEach(function (a) { c.list.appendChild(el('li', null, a)); });
    c.list.style.display = h.advice.length ? '' : 'none';
  }

  var chips = [], started = false;
  function tick() { chips.forEach(function (c) { try { render(c); } catch (e) {} }); }
  function start() {
    if (started) return;
    var slots = doc.querySelectorAll('[data-cestis-sync-chip]');
    if (!slots.length) return;
    started = true;
    if (!doc.getElementById('cestisSyncChipCss')) {
      var st = el('style'); st.id = 'cestisSyncChipCss'; st.textContent = CSS; (doc.head || doc.body).appendChild(st);
    }
    chips = Array.prototype.map.call(slots, mount);
    try { if (cloud() && typeof cloud().lan === 'function') cloud().lan().then(function (on) { lanOn = !!on; tick(); }); } catch (e) {}
    tick();
    setInterval(tick, 3000);
    root.addEventListener('online', tick);
    root.addEventListener('offline', tick);
  }

  root.CESTISSyncChip = { inputs: inputs, refresh: tick };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : this);
