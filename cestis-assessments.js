/* ============================================================================
   cestis-assessments.js — prepared assessments in the dashboard: what every
   role shares, and a trainee's own pages.

   Loaded by index.html the first time a page needs it (assessMount →
   cestisNeedLib('CESTISAssess')); never on a trainee's first page load.
   Staff pages are in cestis-assessments-staff.js, which a trainee's phone
   never fetches. The rules are CESTISCore.assessments (cestis-core.js,
   tested in Node); the printed record is cestis-assessment-pdf.js.

   WHAT A TRAINEE SEES (My Assessments):
     - each of her programme's units with prepared assessments, and the four
       assessments: open now (Start test), opens on a date, submitted, marked;
     - a group practical: her group ("Tameka R." — never an ID or a full
       name), the photos to take, the group's photos, Add photos (each made
       smaller on her phone and sent in parts), Hand in for the group (once,
       for everyone), and her own signature;
     - her own record of each theory test as a PDF, made on her device.
   "Sign and submit" (index.html's submit step calls signDialog): her full
   name in a handwritten style, "I confirm this is my own work", then the
   test is submitted with her signature.

   Every screen says "saved" or "sent"; none says where anything is kept.
   ============================================================================ */
(function () {
  'use strict';
  var W = window;
  var A = W.CESTISCore.assessments, X = W.CESTISCore.exams;
  var SIG_FONT = 'vendor/fonts/GreatVibes-Regular-latin.ttf';

  /* ---- Small helpers ------------------------------------------------- */
  function esc(s) { return typeof W.escapeHtml === 'function' ? W.escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function str(v) { return v == null ? '' : String(v); }
  function toast(msg, type) { try { W.showToast(msg, type); } catch (e) {} }
  function role() { return W.currentRole || ''; }
  function offset() { return typeof W.examCentreOffset === 'function' ? W.examCentreOffset() : X.DEFAULT_OFFSET; }
  function now() { return Date.now(); }
  function nowIso() { return W.CESTISCore.sync && W.CESTISCore.sync.nowIso ? W.CESTISCore.sync.nowIso() : new Date().toISOString(); }
  function gen(prefix) { return typeof W.cestisGenId === 'function' ? W.cestisGenId(prefix) : prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function centreName() {
    var s = W.systemSettings || {};
    return str(s.institutionName).trim() || 'Community Educational and Skills Training Institute and Services Ltd.';
  }
  function exams() { return list(W.exams); }
  function examById(id) { return exams().filter(function (e) { return e && str(e.id) === str(id); })[0] || null; }
  function work() { if (!Array.isArray(W.assessmentWork)) W.assessmentWork = []; return W.assessmentWork; }
  function studentById(id) { return list(W.students).filter(function (s) { return s && str(s.id) === str(id); })[0] || null; }
  function names() { var m = {}; list(W.students).forEach(function (s) { if (s && s.id != null) m[str(s.id)] = str(s.name); }); return m; }
  function gateSession() { return typeof W.cestisGateSession === 'function' && !!W.cestisGateSession(); }
  /* Records of ours, written: into the list (by id, the newer replacing the
     older), stamped and saved like every other record. */
  function saveWork(recs) {
    var w = work();
    (Array.isArray(recs) ? recs : [recs]).forEach(function (r) {
      if (!r || !r.id) return;
      var i = -1;
      w.forEach(function (x, k) { if (x && x.id === r.id) i = k; });
      if (i === -1) w.push(r); else w[i] = r;
    });
    try { W.saveCollection('voctrain_assessmentWork', w); } catch (e) {}
    try { W.saveState(); } catch (e) {}
  }
  function saveExams() {
    try { W.saveCollection('voctrain_exams', W.exams); } catch (e) {}
    try { W.saveState(); } catch (e) {}
  }

  /* ---- Styles (theme tokens only, so Light and Dark both read) -------- */
  var CSS = [
    '.assess{display:block}',
    '.assess .assess-loading{color:var(--text-muted)}',
    '.assess-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin-bottom:14px}',
    '.assess-head h2{font-size:20px;margin:0 0 4px}',
    '.assess-sub{color:var(--text-secondary);font-size:13px;line-height:1.5;margin:0}',
    '.assess-tools{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}',
    '.assess-tools label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:var(--text-secondary)}',
    '.assess-tools .form-control{min-width:150px}',
    '.assess-counts{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 14px}',
    '.assess-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;background:var(--w-06);color:var(--text-primary);border:1px solid var(--border-light)}',
    '.assess-chip.is-check{background:var(--accent-dim);color:var(--accent)}',
    '.assess-chip.is-ready{background:var(--green-dim);color:var(--green)}',
    '.assess-chip.is-open{background:var(--blue-dim);color:var(--info-text)}',
    '.assess-chip.is-none{background:var(--w-04);color:var(--text-muted)}',
    '.assess-chip.is-fail{background:var(--red-dim);color:var(--red-text)}',
    '.assess-note{background:var(--accent-dim);border:1px solid var(--accent-glow);color:var(--text-primary);border-radius:var(--radius-sm);padding:10px 14px;font-size:13px;line-height:1.5;margin-bottom:14px}',
    '.assess-prog{margin-bottom:14px}',
    '.assess-prog>summary{cursor:pointer;list-style:none;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}',
    '.assess-prog>summary::-webkit-details-marker{display:none}',
    '.assess-prog>summary h3{font-size:16px;margin:0}',
    '.assess-prog>summary .assess-sub{font-size:12.5px}',
    '.assess-unit{border-top:1px solid var(--border);padding:14px 0 6px}',
    '.assess-unit:first-of-type{border-top:0}',
    '.assess-unit-title{font-weight:600;font-size:14px;line-height:1.4;margin-bottom:8px}',
    '.assess-unit-title .assess-code{color:var(--text-secondary);font-weight:600;margin-right:6px}',
    '.assess-kinds{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}',
    '.assess-kind{background:var(--w-03);border:1px solid var(--border-light);border-radius:var(--radius-sm);padding:10px 12px;display:flex;flex-direction:column;gap:6px}',
    '.assess-kind-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}',
    '.assess-kind-name{font-weight:700;font-size:13.5px}',
    '.assess-kind-meta{font-size:12px;color:var(--text-muted)}',
    '.assess-acts{display:flex;flex-wrap:wrap;gap:6px}',
    '.assess-acts .btn{padding:6px 10px;font-size:12px}',
    '.assess-empty{color:var(--text-muted);font-size:13px;padding:6px 0}',
    '.assess-table{width:100%;border-collapse:collapse;font-size:13px}',
    '.assess-table th{text-align:left;font-size:12px;color:var(--text-secondary);font-weight:600;padding:8px;border-bottom:1px solid var(--border-light)}',
    '.assess-table td{padding:9px 8px;border-bottom:1px solid var(--border);vertical-align:top}',
    '.assess-table .assess-sid{color:var(--text-muted);font-size:12px}',
    '.assess-row-acts{display:flex;gap:6px;flex-wrap:wrap}',
    '.assess-row-acts .btn{padding:5px 9px;font-size:12px}',
    '.assess-dlg-back{position:fixed;inset:0;z-index:12500;background:var(--scrim);display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow-y:auto}',
    '.assess-dlg{background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-light);border-radius:var(--radius-lg);width:100%;max-width:560px;box-shadow:var(--shadow);margin:auto}',
    '.assess-dlg.is-wide{max-width:920px}',
    '.assess-dlg-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--border)}',
    '.assess-dlg-head h3{margin:0;font-size:17px}',
    '.assess-dlg-body{padding:16px 20px;max-height:calc(100vh - 190px);overflow-y:auto}',
    '.assess-dlg-foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--border)}',
    '.assess-dlg label.assess-field{display:block;margin-bottom:12px;font-size:12px;font-weight:600;color:var(--text-secondary)}',
    '.assess-dlg label.assess-field .form-control{margin-top:5px;width:100%}',
    '.assess-dlg .assess-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '.assess-err{background:var(--red-dim);color:var(--red-text);border-radius:var(--radius-sm);padding:8px 12px;font-size:13px;margin-bottom:10px}',
    '.assess-err[hidden]{display:none}',
    '.assess-sig-box{border:1px dashed var(--border-light);border-radius:var(--radius);padding:16px 18px 10px;background:var(--w-02);margin:10px 0 14px}',
    '.assess-sig-name{font-family:"CESTIS Signature","Brush Script MT","Segoe Script",cursive;font-size:44px;line-height:1.15;color:var(--info-text);border-bottom:1.5px solid var(--text-secondary);padding:0 4px 2px;min-height:58px;overflow-wrap:anywhere}',
    '.assess-sig-under{font-size:12px;color:var(--text-muted);margin-top:6px}',
    '.assess-consent{display:flex;gap:10px;align-items:flex-start;font-size:14px;cursor:pointer;margin:6px 0 4px}',
    '.assess-consent input{width:20px;height:20px;margin-top:1px;flex:none}',
    '.assess-q{border-bottom:1px solid var(--border);padding:10px 0}',
    '.assess-q-n{font-weight:700;margin-right:6px}',
    '.assess-q ol{margin:6px 0 0 18px;padding:0}',
    '.assess-q li.is-key{color:var(--green);font-weight:700}',
    '.assess-q .assess-model{font-size:12.5px;color:var(--text-secondary);margin-top:6px;white-space:pre-wrap}',
    '.assess-members{display:flex;flex-wrap:wrap;gap:10px;margin:6px 0 12px}',
    '.assess-member{display:flex;align-items:center;gap:8px;font-size:13px}',
    '.assess-ava{width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;background:var(--blue-dim);color:var(--info-text)}',
    '.assess-ava.is-me{background:var(--accent-dim);color:var(--accent)}',
    '.assess-shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin:8px 0 12px}',
    '.assess-shot{border:1px solid var(--border-light);border-radius:var(--radius-sm);overflow:hidden;background:var(--w-03);font-size:12px}',
    '.assess-shot-img{aspect-ratio:4/3;background:var(--w-06);display:flex;align-items:center;justify-content:center;color:var(--text-muted);overflow:hidden}',
    '.assess-shot-img img{width:100%;height:100%;object-fit:cover;display:block}',
    '.assess-shot-cap{padding:6px 8px;line-height:1.35}',
    '.assess-shot-cap small{color:var(--text-muted);display:block}',
    '.assess-todo{margin:4px 0 10px 18px;padding:0;font-size:13.5px;line-height:1.7}',
    '.assess-todo li.is-done{color:var(--green)}',
    '.assess-big{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}',
    '.assess-photo-view{display:flex;flex-direction:column;gap:12px}',
    '.assess-photo-view img{max-width:100%;max-height:70vh;object-fit:contain;border-radius:var(--radius-sm);background:var(--w-04)}',
    '.assess-check-grid{width:100%;border-collapse:collapse;font-size:13px}',
    '.assess-check-grid th,.assess-check-grid td{border-bottom:1px solid var(--border);padding:7px 6px;text-align:center}',
    '.assess-check-grid th:first-child,.assess-check-grid td:first-child{text-align:left}',
    '.assess-check-grid input{width:18px;height:18px}',
    '.assess-extra{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--accent);background:var(--accent-dim);padding:3px 9px;border-radius:14px}',
    '@media (max-width:600px){.assess-kinds{grid-template-columns:1fr}.assess-dlg .assess-row2{grid-template-columns:1fr}.assess-sig-name{font-size:36px}',
    '.assess-table thead{display:none}.assess-table tr{display:block;border-bottom:1px solid var(--border-light);padding:8px 0}.assess-table td{display:block;border:0;padding:3px 4px}',
    '.assess-dlg-back{padding:8px}.assess-tools .form-control{min-width:0;width:100%}.assess-tools label{flex:1 1 140px}}'
  ].join('\n');
  function styles() {
    if (document.getElementById('cestis-assess-css')) return;
    var st = document.createElement('style');
    st.id = 'cestis-assess-css';
    st.textContent = CSS + '\n@font-face{font-family:"CESTIS Signature";src:url("' + SIG_FONT + '") format("truetype");font-display:swap}';
    document.head.appendChild(st);
  }

  /* ---- A dialog (the page's own look, Light and Dark) ----------------
     o: { title, body (HTML — every value in it escaped by the caller),
          wide, actions: [{ id, label, kind: 'primary'|'secondary'|'danger',
          close }], onAction(id, dlg) }. Escape or ✕ closes; focus returns. */
  var openDlgs = [];
  function dialog(o) {
    styles();
    var back = document.createElement('div');
    back.className = 'assess-dlg-back';
    var titleId = gen('assess-dlg-t-');
    back.innerHTML = '<div class="assess-dlg' + (o.wide ? ' is-wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '">' +
      '<div class="assess-dlg-head"><h3 id="' + titleId + '">' + esc(o.title) + '</h3><button type="button" class="btn btn-secondary" data-dlg="close" aria-label="Close">✕</button></div>' +
      '<div class="assess-dlg-body">' + (o.body || '') + '</div>' +
      (o.actions && o.actions.length ? '<div class="assess-dlg-foot">' + o.actions.map(function (a) {
        return '<button type="button" class="btn ' + (a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : 'btn-secondary') + '" data-dlg="' + esc(a.id) + '"' + (a.disabled ? ' disabled' : '') + '>' + esc(a.label) + '</button>';
      }).join('') + '</div>' : '') + '</div>';
    var before = document.activeElement;
    var d = { el: back, box: back.firstChild, q: function (sel) { return back.querySelector(sel); }, qa: function (sel) { return Array.prototype.slice.call(back.querySelectorAll(sel)); },
      close: function () {
        if (!back.parentNode) return;
        back.parentNode.removeChild(back);
        openDlgs = openDlgs.filter(function (x) { return x !== d; });
        document.removeEventListener('keydown', onKey, true);
        try { if (before && before.focus) before.focus(); } catch (e) {}
        if (typeof o.onClose === 'function') o.onClose();
      },
      error: function (msg) { var e = back.querySelector('.assess-err'); if (e) { e.textContent = msg || ''; e.hidden = !msg; } else if (msg) toast(msg, 'warning'); } };
    function onKey(ev) { if (ev.key === 'Escape' && openDlgs[openDlgs.length - 1] === d) { ev.stopPropagation(); d.close(); } }
    back.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-dlg]');
      if (!b || b.disabled) return;
      var id = b.getAttribute('data-dlg');
      if (id === 'close') { d.close(); return; }
      var a = (o.actions || []).filter(function (x) { return x.id === id; })[0];
      if (typeof o.onAction === 'function') o.onAction(id, d, ev);
      if (a && a.close) d.close();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    openDlgs.push(d);
    setTimeout(function () { var f = back.querySelector('input:not([type=hidden]),select,textarea,.btn-primary') || back.querySelector('[data-dlg]'); try { f.focus(); } catch (e) {} }, 30);
    return d;
  }
  function confirmDlg(title, text, okLabel) {
    return new Promise(function (resolve) {
      var done = false;
      dialog({ title: title, body: '<p style="margin:0;line-height:1.55">' + esc(text) + '</p>',
        actions: [{ id: 'no', label: 'Cancel', close: true }, { id: 'yes', label: okLabel || 'OK', kind: 'primary', close: true }],
        onAction: function (id) { done = true; resolve(id === 'yes'); }, onClose: function () { if (!done) resolve(false); } });
    });
  }

  /* ---- Files: a PDF to look at or keep -------------------------------- */
  function blobOf(bytes, mime) { return bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime || 'application/pdf' }); }
  // As jsPDF's own saver does: the link is let go only well after the browser
  // has the file (let go too soon, the file loses its name).
  function download(bytes, name, mime) {
    var url = URL.createObjectURL(blobOf(bytes, mime));
    var a = document.createElement('a');
    // A dash a browser may not save under (the folder copies keep "—").
    a.href = url; a.download = String(name || 'record.pdf').replace(/[\u2013\u2014]/g, '-'); a.rel = 'noopener';
    setTimeout(function () { try { a.dispatchEvent(new MouseEvent('click')); } catch (e) { a.click(); } }, 0);
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
  }
  /* View: in a new tab where the browser allows it, else saved. */
  function view(bytes, name) {
    var url = URL.createObjectURL(blobOf(bytes));
    var w = null;
    try { w = W.open(url, '_blank', 'noopener'); } catch (e) { w = null; }
    if (!w) download(bytes, name);
    setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
  }
  /* jsPDF, the layout, the signature font and the crest — from this site. */
  function pdfKit() {
    return W.cestisNeedLib('jspdf').then(function () { return W.cestisNeedLib('CESTISAssessPdf'); })
      .then(function () { return W.CESTISAssessPdf.assets(); })
      .then(function (assets) { return { jsPDF: W.jspdf.jsPDF, font: assets.font, crest: assets.crest }; });
  }
  function renderPdf(model, extra) {
    return pdfKit().then(function (k) {
      var doc = W.CESTISAssessPdf.render(model, Object.assign({ jsPDF: k.jsPDF, font: k.font, crest: k.crest }, extra || {}));
      return new Uint8Array(doc.output('arraybuffer'));
    });
  }

  /* ---- The pages: which one is on screen, and drawing it again -------- */
  var mounted = {};
  function rootFor(feature) {
    var all = Array.prototype.slice.call(document.querySelectorAll('[data-assess-page="' + feature + '"]'));
    return all.filter(function (el) { return el.closest('.page.active'); })[0] || all[0] || null;
  }
  function refresh(what) {
    Object.keys(mounted).forEach(function (f) {
      var m = mounted[f];
      var root = rootFor(f);
      if (!root || !root.closest('.page.active') || !m || typeof m.render !== 'function') return;
      // Never draw over something being typed or a dialog in use.
      if (openDlgs.length || (document.activeElement && root.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) return;
      try { m.render(root, what); } catch (e) { console.warn('[Assessments] could not refresh', f, e); }
    });
  }
  function register(feature, render) { mounted[feature] = { render: render }; }

  /* ---- A trainee's own assessments --------------------------------- */
  var Trainee = {};

  /* ==================================================================
     A TRAINEE'S OWN ASSESSMENTS
     ================================================================== */
  var COPY_PREFIX = 'cestisAssessSessionCopy__';   // her device only (never backed up or synced)
  function store() { return W.CESTISStore; }
  function readJson(k, d) { try { var v = JSON.parse(store().getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function me() { return W.currentStudent || null; }
  function sameCourse(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    try { return typeof W.instructorCourseMatch === 'function' && W.instructorCourseMatch(a, b); } catch (e) { return false; }
  }
  /* What is kept of the assessment records here, newest copy of each (what
     this page holds and what the gate or a sync wrote since). */
  function allWork() {
    var mem = work(), stored = readJson('voctrain_assessmentWork', []);
    var by = {};
    [stored, mem].forEach(function (l) { list(l).forEach(function (r) {
      if (!r || !r.id) return;
      var was = by[r.id];
      if (!was || (Date.parse(r.updatedAt || '') || 0) >= (Date.parse(was.updatedAt || '') || 0)) by[r.id] = r;
    }); });
    return Object.keys(by).map(function (k) { return by[k]; });
  }
  /* Her records written: merged with what is stored (never written over
     with less), then saved like any of her records — from home the watcher
     seals and sends them. */
  function saveMine(recs) {
    var merged = allWork(), at = {};
    merged.forEach(function (r, i) { at[r.id] = i; });
    (Array.isArray(recs) ? recs : [recs]).forEach(function (r) { if (!r || !r.id) return; if (at[r.id] == null) { at[r.id] = merged.length; merged.push(r); } else merged[at[r.id]] = r; });
    W.assessmentWork = merged;
    try { W.saveCollection('voctrain_assessmentWork', merged); } catch (e) { try { store().setItem('voctrain_assessmentWork', JSON.stringify(merged)); } catch (x) {} }
    try { if (!gateSession()) W.saveState(); } catch (e) {}
    try { if (gateSession() && W.CESTISGate && W.CESTISGate.capture) W.CESTISGate.capture(); } catch (e) {}
  }
  function myExams() {
    var s = me();
    if (!s) return [];
    return exams().filter(function (e) { return A.isAssessment(e) && !A.isMaster(e) && e.status !== 'draft' && e.status !== 'cancelled' && sameCourse(e.course, s.course); });
  }
  /* Her groups: the gate's view of them at home; worked out from the
     records at the Centre (the same rule, Core.assessments.traineeView). */
  function myGroups() {
    var s = me();
    if (!s) return [];
    if (gateSession()) return list(readJson('voctrain_assessmentGroups', []));
    var w = allWork(), nm = names(), out = [];
    w.forEach(function (g) {
      if (!g || g.type !== 'group' || g.withdrawn || list(g.members).map(str).indexOf(str(s.id)) === -1) return;
      var v = A.traineeView(g, w, s.id, nm);
      if (v) out.push(v);
    });
    return out;
  }
  function groupFor(examId) { return myGroups().filter(function (g) { return str(g.examId) === str(examId); })[0] || null; }
  function resultFor(examId) {
    var s = me();
    return list(W.examResults).filter(function (r) { return r && !r.archived && str(r.examId) === str(examId) && s && str(r.studentId) === str(s.id); })
      .sort(function (a, b) { return (Date.parse(a.submittedAt || '') || 0) - (Date.parse(b.submittedAt || '') || 0); })[0] || null;
  }
  function copyFor(examId) {
    var s = me(), best = null;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(COPY_PREFIX) === -1 || k.indexOf(COPY_PREFIX + 'thumbs') !== -1) continue;
        var v = JSON.parse(localStorage.getItem(k) || 'null');
        if (v && str(v.examId) === str(examId) && s && str(v.studentId) === str(s.id) && (!best || v.submittedAt > best.submittedAt)) best = v;
      }
    } catch (e) {}
    return best;
  }
  function whenText(ms) { return A.when(ms, offset()); }
  function clockText(ms) {
    try { var p = X.centreParts(ms, offset()); var t = p.time.split(':').map(Number); return (t[0] % 12 || 12) + ':' + String(t[1]).padStart(2, '0') + (t[0] >= 12 ? ' pm' : ' am'); } catch (e) { return ''; }
  }
  function statusNow(e) { try { return W.examStatusNow(e); } catch (x) { return X.statusAt(e, now(), offset()); } }
  function theoryRow(e) {
    var s = me(), r = resultFor(e.id), K = A.KINDS[e.assessment.kind], st = statusNow(e);
    var w = X.windowOf(e, offset());
    var line = '', acts = '', chip = '';
    var cur = null;
    try { cur = typeof W.examCurrentAttempt === 'function' ? W.examCurrentAttempt(s.id, e.id) : null; } catch (x) { cur = null; }
    var sentLater = !r && copyFor(e.id);
    if (r) {
      var prov = X.isProvisional(r);
      chip = prov ? '<span class="assess-chip is-check">Awaiting marking</span>' : (r.passed ? '<span class="assess-chip is-ready">Competent</span>' : '<span class="assess-chip is-fail">Not yet competent</span>');
      line = 'Submitted ' + esc(whenText(r.submittedAt)) + (prov ? ' · marks so far ' + esc(r.score) + '%' : ' · ' + esc(r.score) + '%');
      acts = '<button type="button" class="btn btn-secondary" data-act="mypdf" data-id="' + esc(e.id) + '">Download my record (PDF)</button>';
    } else if (sentLater) {
      chip = '<span class="assess-chip is-check">Submitted</span>';
      line = 'Submitted ' + esc(whenText(sentLater.submittedAt)) + '. Your result follows once it reaches the office.';
      acts = '<button type="button" class="btn btn-secondary" data-act="mypdf" data-id="' + esc(e.id) + '">Download my record (PDF)</button>';
    } else if (cur && cur.attempt) {
      chip = '<span class="assess-chip is-open">In progress</span>';
      line = 'Your answers are saved.';
      acts = '<button type="button" class="btn btn-primary" data-act="start" data-id="' + esc(e.id) + '">Continue your attempt</button>';
    } else if (st === 'active') {
      chip = '<span class="assess-chip is-ready">Open now</span>';
      line = esc(X.questionCount(e)) + ' questions · ' + esc(A.minutesText(e.duration)) + (w && w.end ? ' · until ' + esc(clockText(w.baseEnd != null ? w.baseEnd : w.end)) : '');
      acts = '<button type="button" class="btn btn-primary" data-act="start" data-id="' + esc(e.id) + '">Start test</button>';
    } else if (st === 'upcoming') {
      chip = '<span class="assess-chip is-none">Opens ' + esc(w ? whenText(w.start) : '') + '</span>';
      line = esc(X.questionCount(e)) + ' questions · ' + esc(A.minutesText(e.duration));
    } else {
      chip = '<span class="assess-chip is-none">Closed</span>';
      line = 'Not sat.';
    }
    return '<div class="assess-kind"><div class="assess-kind-top"><span class="assess-kind-name">' + esc(K.label) + '</span>' + chip + '</div>' +
      '<div class="assess-kind-meta">' + line + '</div>' + (acts ? '<div class="assess-acts">' + acts + '</div>' : '') + '</div>';
  }
  function practicalRow(e) {
    var K = A.KINDS[e.assessment.kind], g = groupFor(e.id), st = A.practicalStatus(e, now(), offset());
    var p = e.practical || {};
    var chip, line, acts = '';
    if (!g) { chip = '<span class="assess-chip is-none">' + (st === 'upcoming' ? 'Not open yet' : 'No group yet') + '</span>'; line = 'Your instructor puts you in a group of 4 or 5.'; }
    else {
      var mineRes = allWork().filter(function (r) { return r.type === 'result' && str(r.examId) === str(e.id) && me() && str(r.studentId) === str(me().id); })[0];
      chip = mineRes ? (mineRes.outcome === 'competent' ? '<span class="assess-chip is-ready">Competent</span>' : '<span class="assess-chip is-fail">Not yet competent</span>')
        : g.handedInAt ? '<span class="assess-chip is-open">Handed in</span>' : st === 'open' ? '<span class="assess-chip is-ready">Open now</span>' : st === 'upcoming' ? '<span class="assess-chip is-none">Opens ' + esc(whenText(X.windowOf({ date: e.date, time: e.time, duration: 1 }, offset()).start)) + '</span>' : '<span class="assess-chip is-none">Closed</span>';
      line = esc(g.name) + ' · ' + g.photos.length + ' of ' + list(p.photos).length + ' photos' + (p.title ? '<br>' + esc(p.title) : '');
      acts = '<button type="button" class="btn ' + (g.handedInAt && g.mySignature ? 'btn-secondary' : 'btn-primary') + '" data-act="group" data-id="' + esc(e.id) + '">' + (g.handedInAt && !g.mySignature ? 'Sign for your part' : 'Open group task') + '</button>';
    }
    return '<div class="assess-kind"><div class="assess-kind-top"><span class="assess-kind-name">' + esc(K.label) + '</span>' + chip + '</div>' +
      '<div class="assess-kind-meta">' + line + '</div>' + (acts ? '<div class="assess-acts">' + acts + '</div>' : '') + '</div>';
  }
  Trainee.render = function (root) {
    root = root || rootFor('my-assessments');
    if (!root) return;
    styles();
    var s = me();
    if (!s) { root.innerHTML = '<div class="card assess-empty">Sign in to see your assessments.</div>'; return; }
    var units = {}, order = [];
    myExams().forEach(function (e) {
      var a = e.assessment, k = (A.normCode(a.unitCode) || A.normTitle(a.unitTitle));
      if (!units[k]) { units[k] = { code: a.unitCode, title: a.unitTitle, kinds: {} }; order.push(k); }
      var have = units[k].kinds[a.kind];
      if (!have || (Date.parse(e.createdAt || '') || 0) > (Date.parse(have.createdAt || '') || 0)) units[k].kinds[a.kind] = e;
    });
    order.sort(function (a, b) { return units[a].code < units[b].code ? -1 : 1; });
    var body = order.map(function (k) {
      var u = units[k];
      return '<div class="card"><div class="assess-unit-title">' + (u.code ? '<span class="assess-code">' + esc(u.code) + '</span>' : '') + esc(u.title) + '</div><div class="assess-kinds">' +
        A.ORDER.map(function (kind) {
          var e = u.kinds[kind];
          if (!e) return '<div class="assess-kind"><div class="assess-kind-top"><span class="assess-kind-name">' + esc(A.KINDS[kind].label) + '</span><span class="assess-chip is-none">Not open yet</span></div></div>';
          return A.isPractical(e) ? practicalRow(e) : theoryRow(e);
        }).join('') + '</div></div>';
    }).join('');
    root.innerHTML = '<div class="assess-head"><div><h2>My Assessments</h2><p class="assess-sub">Each unit\'s Theory 1, Theory 2, Practical 1 and Practical 2. Your answers are saved as you go, and a test carries on if you are cut off.</p></div></div>' +
      (body || '<div class="card assess-empty">No assessments are open for your programme yet.</div>');
  };

  /* ---- Her record as a PDF, made on her device -------------------------- */
  function myPdf(examId) {
    var e = examById(examId), s = me();
    if (!e || !s) return;
    var r = resultFor(examId), copy = copyFor(examId);
    var questions = copy && Array.isArray(copy.questions) ? copy.questions : null;
    if (!questions && gateSession() && W.CESTISGate && W.CESTISGate.storedPaper) { try { var pp = W.CESTISGate.storedPaper(examId); if (pp && pp.questions) questions = pp.questions; } catch (x) {} }
    if (!questions) questions = X.publicQuestions(e.questionData);
    var reveal = false;
    try { reveal = gateSession() ? false : X.canRevealAnswers(e, now(), offset()); } catch (x) { reveal = false; }
    var result = r;
    if (r && !reveal) {
      // Her own copy before the right answers are released: none on it.
      result = JSON.parse(JSON.stringify(r));
      list(result.answers).forEach(function (a) { if (a) delete a.correctAnswer; });
    }
    var path = A.folderPath({ programme: e.assessment.programme, intake: e.assessment.intake || e.course, unitCode: e.assessment.unitCode, unitTitle: e.assessment.unitTitle, kind: e.assessment.kind });
    var model = A.theoryModel({ exam: reveal ? e : Object.assign({}, e, { questionData: questions }), result: result, questions: questions, answers: copy ? copy.answers : null,
      startedAt: copy ? copy.startTime : null, finishedAt: copy ? copy.submittedAt : null, student: { id: s.id, name: s.name },
      signature: (r && r.signature) || (copy && copy.signature) || null, sat: { where: gateSession() ? 'home' : 'centre' }, centreName: centreName(), offset: offset(),
      madeAt: now(), revealAnswers: reveal, path: path, basis: (r && r.attemptId) || (copy && copy.attemptId) || (r && r.id) || '' });
    var name = A.paperFileName({ name: s.name, studentId: s.id, unitCode: e.assessment.unitCode, unitTitle: e.assessment.unitTitle, kind: e.assessment.kind });
    toast('Making your record…', 'info');
    return renderPdf(model).then(function (bytes) { download(bytes, name); toast('Your record is saved to this device: ' + name); return bytes; },
      function () { toast('Your record could not be made just now. Check the connection and try again.', 'error'); });
  }
  Trainee.myPdf = myPdf;

  /* ---- Signing (her name in a handwritten style) ------------------------ */
  function signDialog(o) {
    return new Promise(function (resolve) {
      var name = str(o.name).replace(/\s+/g, ' ').trim(), done = false;
      dialog({ title: o.title || 'Sign', body: (o.intro ? '<p style="margin:0 0 10px;line-height:1.5">' + esc(o.intro) + '</p>' : '') +
        '<div style="font-size:12px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px">Adopt your signature</div>' +
        '<div class="assess-sig-box"><div class="assess-sig-name" aria-label="Your signature: ' + esc(name) + '">' + esc(name) + '</div>' +
        '<div class="assess-sig-under">' + esc(name) + ' · ' + esc(whenText(now())) + '</div></div>' +
        '<label class="assess-consent"><input type="checkbox" data-f="consent"> <span>' + esc(o.consent || 'I confirm this is my own work.') + '</span></label>',
        actions: [{ id: 'cancel', label: 'Cancel', close: true }, { id: 'sign', label: o.button || 'Sign', kind: 'primary', disabled: true }],
        onAction: function (id, d) {
          if (id !== 'sign') return;
          if (!d.q('[data-f="consent"]').checked) return;
          done = true; d.close();
          resolve(A.makeSignature({ name: name, at: nowIso(), basis: o.basis }));
        },
        onClose: function () { if (!done) resolve(null); } });
      var last = openDlgs[openDlgs.length - 1];
      var box = last && last.q('[data-f="consent"]');
      if (box) box.onchange = function () { var b = last.q('[data-dlg="sign"]'); if (b) b.disabled = !box.checked; };
    });
  }
  Trainee.signDialog = signDialog;

  /* ---- The group practical --------------------------------------------- */
  var THUMBS = COPY_PREFIX + 'thumbs__';
  function thumbs(groupId) { return readJson(THUMBS + groupId, {}) || {}; }
  function keepThumb(groupId, photoId, dataUrl) {
    var t = thumbs(groupId);
    t[photoId] = dataUrl;
    var ids = Object.keys(t);
    if (ids.length > 60) ids.slice(0, ids.length - 60).forEach(function (k) { delete t[k]; });
    try { store().setItem(THUMBS + groupId, JSON.stringify(t)); } catch (e) {}
  }
  function smallThumb(file) {
    return new Promise(function (resolve) {
      try {
        var url = URL.createObjectURL(file), img = new Image();
        img.onload = function () {
          var k = Math.min(1, 240 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve({ thumb: c.toDataURL('image/jpeg', 0.6), w: img.naturalWidth, h: img.naturalHeight });
        };
        img.onerror = function () { URL.revokeObjectURL(url); resolve({ thumb: '', w: 0, h: 0 }); };
        img.src = url;
      } catch (e) { resolve({ thumb: '', w: 0, h: 0 }); }
    });
  }
  function readDataUrl(file) {
    return new Promise(function (resolve, reject) { var fr = new FileReader(); fr.onload = function () { resolve(fr.result); }; fr.onerror = reject; fr.readAsDataURL(file); });
  }
  function photosCanBeSent() {
    if (!gateSession()) return { ok: false, why: 'Photos are added from your own phone at home. At the Centre, your instructor can add them for the group.' };
    var sess = W.CESTISGate && W.CESTISGate.session ? W.CESTISGate.session() : null;
    if (!sess || (sess.base && sess.base.kind === 'lan')) return { ok: false, why: 'Photos cannot be sent from the Centre\'s own network. Add them from your phone at home, or ask your instructor.' };
    return { ok: true };
  }
  var groupView = { examId: null };
  function openGroup(examId) {
    var e = examById(examId), g = groupFor(examId), s = me();
    if (!e || !g || !s) { toast('You are not in a group for this practical yet. Your instructor makes the groups.', 'warning'); return; }
    groupView.examId = examId;
    var d = dialog({ title: A.KINDS[e.assessment.kind].label + ' · ' + g.name, wide: true, body: '<div data-g="body"></div>', onClose: function () { groupView.examId = null; Trainee.render(); } });
    groupView.dlg = d;
    drawGroup();
    d.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-gact]');
      if (!b) return;
      var a = b.getAttribute('data-gact');
      if (a === 'add') pickPhotos();
      else if (a === 'send') sendPicked();
      else if (a === 'handin') handIn(false);
      else if (a === 'sign') handIn(true);
      else if (a === 'view') viewPhoto(b.getAttribute('data-file'), b.getAttribute('data-cap'));
      else if (a === 'drop') dropPicked(Number(b.getAttribute('data-i')));
    });
    d.el.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.getAttribute('data-gf') === 'files') addPicked(t.files);
      if (t.getAttribute('data-cap-i') != null) groupView.picked[Number(t.getAttribute('data-cap-i'))].caption = t.value;
    });
  }
  Trainee.openGroup = openGroup;
  function drawGroup() {
    var d = groupView.dlg;
    if (!d || !d.el.parentNode) return;
    var e = examById(groupView.examId), g = groupFor(groupView.examId), s = me();
    if (!e || !g) return;
    var p = e.practical || {}, st = A.practicalStatus(e, now(), offset()), th = thumbs(g.id);
    var taken = {};
    g.photos.forEach(function (ph) { taken[A.normTitle(ph.caption)] = 1; });
    var waiting = (groupView.waiting || []).filter(function (u) { return u.state !== 'done'; });
    var can = photosCanBeSent();
    var open = st === 'open' && !g.handedInAt;
    var html = (p.title ? '<h4 style="margin:0 0 6px">' + esc(p.title) + '</h4>' : '') + '<p style="white-space:pre-wrap;line-height:1.55;margin:0 0 10px">' + esc(p.brief) + '</p>' +
      (p.time ? '<p class="assess-sub">Time: ' + esc(p.time) + '</p>' : '') +
      '<h4 style="margin:14px 0 4px">Your group</h4><div class="assess-members">' + g.members.map(function (m) {
        return '<span class="assess-member"><span class="assess-ava' + (m.me ? ' is-me' : '') + '" aria-hidden="true">' + esc(m.i) + '</span>' + esc(m.n) + (m.me ? ' (you)' : '') + (m.signed ? ' ✓' : '') + '</span>';
      }).join('') + '</div>' +
      '<h4 style="margin:14px 0 4px">Photos to take</h4><ul class="assess-todo">' + list(p.photos).map(function (x) { var dn = !!taken[A.normTitle(x)]; return '<li' + (dn ? ' class="is-done"' : '') + '>' + (dn ? '✓ ' : '') + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<h4 style="margin:14px 0 4px">The group\'s photos (' + g.photos.length + ')</h4>' +
      (g.photos.length ? '<div class="assess-shots">' + g.photos.map(function (ph) {
        var img = ph.mine && th[ph.id] ? '<img src="' + esc(th[ph.id]) + '" alt="' + esc(ph.caption) + '">' : '<span aria-hidden="true">📷</span>';
        return '<div class="assess-shot"><div class="assess-shot-img">' + img + '</div><div class="assess-shot-cap">' + esc(ph.caption || 'Photo') + '<small>' + esc(ph.by) + ' · ' + esc(whenText(ph.at)) + (ph.late ? ' · after the hand-in' : '') + '</small>' +
          (ph.fileId && !ph.mine && can.ok ? '<button type="button" class="btn btn-secondary" style="margin-top:4px;padding:3px 8px;font-size:12px" data-gact="view" data-file="' + esc(ph.fileId) + '" data-cap="' + esc(ph.caption) + '">View</button>' : '') + '</div></div>';
      }).join('') + '</div>' : '<p class="assess-empty">No photos yet.</p>') +
      (waiting.length ? '<div class="assess-note" role="status">' + waiting.length + ' photo' + (waiting.length === 1 ? ' is' : 's are') + ' being sent. They are kept on your phone and finish sending by themselves, even if the signal drops.</div>' : '');
    if (open) {
      var picked = groupView.picked || [];
      html += '<div class="assess-big">' + (can.ok ? '<label class="btn btn-secondary" style="cursor:pointer">＋ Add photos<input type="file" accept="image/*" multiple data-gf="files" hidden></label>' : '') +
        '</div>' + (can.ok ? '<p class="assess-sub">Anyone in the group can add as many photos as needed. Each one is made smaller on your phone and sent by itself, even if the signal drops.</p>' : '<p class="assess-sub">' + esc(can.why) + '</p>');
      if (picked.length) {
        var opts = list(p.photos).concat(['Other']);
        html += '<div class="card" style="margin-top:10px"><strong>Ready to send (' + picked.length + ')</strong>' + picked.map(function (pk, i) {
          return '<div style="display:flex;gap:10px;align-items:center;margin-top:8px"><img src="' + esc(pk.thumb) + '" alt="" style="width:64px;height:48px;object-fit:cover;border-radius:6px">' +
            '<select class="form-control" data-cap-i="' + i + '" aria-label="What this photo shows">' + opts.map(function (o) { return '<option' + (o === pk.caption ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>' +
            '<button type="button" class="btn btn-secondary" data-gact="drop" data-i="' + i + '" aria-label="Remove">✕</button></div>';
        }).join('') + '<div class="assess-big"><button type="button" class="btn btn-primary" data-gact="send">Send ' + picked.length + ' photo' + (picked.length === 1 ? '' : 's') + '</button></div></div>';
      }
      html += '<div class="assess-big"><button type="button" class="btn btn-primary" data-gact="handin"' + (g.photos.length ? '' : ' disabled') + '>Hand in for ' + esc(g.name) + '</button></div>' +
        '<p class="assess-sub">Handed in once for all ' + g.total + '. Each member\'s record shows it. You sign when you hand in; the others sign the next time they open it.</p>';
    } else if (g.handedInAt) {
      html += '<div class="assess-note">Handed in by ' + esc(g.handedInBy) + ', ' + esc(whenText(g.handedInAt)) + '. ' + g.signedCount + ' of ' + g.total + ' have signed.</div>';
      if (!g.mySignature) html += '<div class="assess-big"><button type="button" class="btn btn-primary" data-gact="sign">Sign for your part</button></div>';
      else html += '<p class="assess-sub">You signed on ' + esc(whenText(g.mySignature.at)) + '. Your assessor records a result for each member.</p>';
    } else {
      html += '<div class="assess-note">' + (st === 'upcoming' ? 'This practical is not open yet.' : 'This practical has closed.') + '</div>';
    }
    if (p.safety && p.safety.length) html += '<h4 style="margin:14px 0 4px">Safety</h4><ul class="assess-todo">' + p.safety.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    d.q('[data-g="body"]').innerHTML = html;
  }
  function addPicked(files) {
    var e = examById(groupView.examId), p = (e && e.practical) || {};
    var have = (groupView.picked || []).length;
    var g = groupFor(groupView.examId), taken = {};
    if (g) g.photos.forEach(function (ph) { taken[A.normTitle(ph.caption)] = 1; });
    var next = list(p.photos).filter(function (x) { return !taken[A.normTitle(x)]; });
    var arr = Array.prototype.slice.call(files || []);
    groupView.picked = groupView.picked || [];
    Promise.all(arr.map(function (f) { return (typeof W.homeShrinkImage === 'function' ? W.homeShrinkImage(f) : Promise.resolve(f)).then(function (small) { return smallThumb(small).then(function (t) { return { file: small, thumb: t.thumb, w: t.w, h: t.h }; }); }); }))
      .then(function (made) {
        made.forEach(function (m, i) { m.caption = next[have + i] || 'Other'; groupView.picked.push(m); });
        drawGroup();
      });
  }
  function dropPicked(i) { (groupView.picked || []).splice(i, 1); drawGroup(); }
  function sendPicked() {
    var g = groupFor(groupView.examId), s = me(), e = examById(groupView.examId);
    var picked = (groupView.picked || []).slice();
    if (!g || !s || !e || !picked.length) return;
    var sess = W.CESTISGate.session();
    groupView.picked = [];
    groupView.waiting = groupView.waiting || [];
    Promise.all(picked.map(function (pk) {
      var id = gen('AP-');
      var rec = A.photoRecord({ id: id, examId: e.id, groupId: g.id, studentId: s.id, accountId: sess && sess.acct, caption: pk.caption, at: nowIso(), files: [], w: pk.w, h: pk.h });
      if (pk.thumb) keepThumb(g.id, id, pk.thumb);
      return readDataUrl(pk.file).then(function (dataUrl) {
        return W.CESTISGate.uploadQueue({ refId: g.id, purpose: 'practical', files: [{ name: (A.safeName(pk.caption || 'photo', 60) + '.jpg').replace(/\s+/g, '-'), type: pk.file.type || 'image/jpeg', dataUrl: dataUrl }],
          then: { key: 'voctrain_assessmentWork', rec: rec } });
      }).then(function (view) { groupView.waiting.push({ id: view.id, state: 'wait' }); });
    })).then(function () {
      drawGroup();
      toast('Sending your photos. They finish by themselves, even if the signal drops.');
      try { W.CESTISGate.uploadPump(); } catch (x) {}
    }, function () { toast('Your photos could not be kept on this phone. Please try again.', 'error'); });
  }
  function viewPhoto(fileId, caption) {
    if (!W.CESTISGate || !W.CESTISGate.fileGet) return;
    var d = dialog({ title: caption || 'Photo', wide: true, body: '<div class="assess-photo-view"><p class="assess-sub">Opening…</p></div>' });
    W.CESTISGate.fileGet(fileId).then(function (res) {
      if (!res || res.ok !== true || !res.base64) { d.q('.assess-photo-view').innerHTML = '<p class="assess-sub">This photo cannot be opened just now.</p>'; return; }
      d.q('.assess-photo-view').innerHTML = '<img alt="' + esc(caption) + '" src="data:' + esc(res.mime || 'image/jpeg') + ';base64,' + esc(res.base64) + '">';
    });
  }
  /* Hand in for the group (once, for everyone), or sign for her part after. */
  function handIn(onlySign) {
    var g = groupFor(groupView.examId), s = me(), e = examById(groupView.examId);
    if (!g || !s || !e) return;
    if (!onlySign && g.handedInAt) { toast('Your group has already handed in.', 'info'); drawGroup(); return; }
    signDialog({ name: s.name, basis: g.id + '|' + s.id, title: onlySign ? 'Sign for your part' : 'Hand in for ' + g.name,
      intro: onlySign ? 'Your group handed in. Sign to say you took part.' : 'This hands in the group\'s work, with its ' + g.photos.length + ' photos, once for everyone. It cannot be changed afterwards.',
      consent: onlySign ? 'I confirm I took part in this work.' : 'I confirm this is our group\'s own work and that I took part.', button: onlySign ? 'Sign' : 'Sign and hand in' })
      .then(function (sig) {
        if (!sig) return;
        var sess = gateSession() && W.CESTISGate ? W.CESTISGate.session() : null;
        var acct = sess ? sess.acct : (W.currentLoggedInUser && W.currentLoggedInUser.id);
        var rec = A.signoffRecord({ groupId: g.id, examId: e.id, studentId: s.id, accountId: acct, name: s.name, signature: sig, handIn: !onlySign, at: sig.at });
        if (!rec) return;
        saveMine(rec);
        toast(onlySign ? 'Signed. Thank you.' : 'Handed in for ' + g.name + '. Each member\'s record shows it.');
        if (!gateSession()) { drawGroup(); return; }
        // From home: her phone shows it at once; the others see it once the office has it.
        setTimeout(drawGroup, 50);
      });
  }
  // Her groups at home come from the gate; what she sent shows at once.
  var _gateGroupsHook = false;
  function hookUploads() {
    if (_gateGroupsHook || !W.CESTISGate || typeof W.CESTISGate.onUpload !== 'function') return;
    _gateGroupsHook = true;
    W.CESTISGate.onUpload(function (ev) {
      if (!ev || !ev.entry) return;
      if (ev.type === 'filed' && ev.key === 'voctrain_assessmentWork' && ev.rec) saveMine(ev.rec);
      if (ev.type === 'done' || ev.type === 'refused' || ev.type === 'waiting') {
        (groupView.waiting || []).forEach(function (u) { if (u.id === ev.entry.id) u.state = ev.type === 'done' ? 'done' : 'wait'; });
        if (ev.type === 'refused') toast('A photo could not be sent: ' + str(ev.error), 'warning');
      }
      drawGroup();
    });
  }
  /* A group's view at home also includes what she has sent but the office
     has not taken in yet (her own photos and sign-off). */
  var _myGroups = myGroups;
  myGroups = function () {
    var gs = _myGroups(), s = me();
    if (!gateSession() || !s) return gs;
    var mine = allWork().filter(function (r) { return r && str(r.studentId) === str(s.id) && (r.type === 'photo' || r.type === 'signoff') && !r.withdrawn; });
    return gs.map(function (g) {
      var v = JSON.parse(JSON.stringify(g));
      mine.forEach(function (r) {
        if (str(r.groupId) !== str(v.id)) return;
        if (r.type === 'photo' && !v.photos.some(function (p) { return p.id === r.id; })) {
          var f = list(r.driveFiles)[0];
          v.photos.push({ id: r.id, caption: r.caption, by: 'You', at: r.addedAt, mine: true, fileId: f ? f.id : '', late: false });
        }
        if (r.type === 'signoff') {
          if (!v.mySignature) { v.mySignature = r.signature; v.signedCount++; }
          v.members.forEach(function (m) { if (m.me) m.signed = true; });
          if (r.handIn && !v.handedInAt) { v.handedInAt = r.handInAt || r.updatedAt; v.handedInBy = 'You'; }
        }
      });
      v.photos.sort(function (a, b) { return (Date.parse(a.at || '') || 0) - (Date.parse(b.at || '') || 0); });
      return v;
    });
  };

  function bindMine(root) {
    if (root._assessBound) return;
    root._assessBound = true;
    root.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]');
      if (!b || !root.contains(b)) return;
      var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
      if (act === 'start') { try { W.showPage('s-exams'); } catch (x) {} setTimeout(function () { try { W.startStudentExam(id); } catch (x) {} }, 120); }
      else if (act === 'mypdf') myPdf(id);
      else if (act === 'group') { var g = groupFor(id); openGroup(id); if (g && g.handedInAt && !g.mySignature) setTimeout(function () { handIn(true); }, 200); }
    });
  }
  Trainee.bind = bindMine;
  Trainee.hookUploads = hookUploads;
  Trainee.groupFor = function (id) { return groupFor(id); };

  function mount(feature, prefix) {
    styles();
    var root = rootFor(feature);
    if (!root) return;
    if (feature === 'my-assessments') {
      Trainee.bind(root);
      Trainee.hookUploads();
      register(feature, Trainee.render);
      Trainee.render(root);
    }
  }

  W.CESTISAssess = {
    mount: mount, refresh: refresh, register: register, rootFor: rootFor,
    // shared with the staff part
    esc: esc, str: str, toast: toast, role: role, offset: offset, now: now, nowIso: nowIso, gen: gen, list: list,
    centreName: centreName, exams: exams, examById: examById, work: work, studentById: studentById, names: names,
    gateSession: gateSession, saveWork: saveWork, saveExams: saveExams, styles: styles, dialog: dialog, confirm: confirmDlg,
    download: download, view: view, pdfKit: pdfKit, renderPdf: renderPdf, blobOf: blobOf,
    signDialog: function (o) { return Trainee.signDialog(o); }, myPdf: function (id) { return Trainee.myPdf(id); },
    Trainee: Trainee
  };
})();
