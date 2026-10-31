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
  function download(bytes, name, mime) {
    var url = URL.createObjectURL(blobOf(bytes, mime));
    var a = document.createElement('a');
    a.href = url; a.download = name || 'record.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 4000);
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

  /* ---- A trainee's own assessments (filled in below) ------------------ */
  var Trainee = {};

  function mount(feature, prefix) {
    styles();
    var root = rootFor(feature);
    if (!root) return;
    if (feature === 'my-assessments') {
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
    Trainee: Trainee
  };
})();
