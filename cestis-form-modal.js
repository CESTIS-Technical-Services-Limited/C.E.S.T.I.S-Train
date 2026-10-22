/* ============================================================================
   cestis-form-modal.js — a small labelled form in a dialog, in place of the
   browser's prompt() boxes.

   WHY THIS EXISTS
   ---------------
   A dozen places collected an amount, a name, a reason or a number with
   window.prompt(): a box the page cannot style or label, that shows a
   password as plain text, that cannot say what is wrong with what was typed
   (a bad amount was refused only after the box had gone), that chains two
   boxes for two fields, and that is awkward on a phone. The calendar's event
   form (index.html, calendarEventModal) replaced its five prompts with one
   form; this is the same pattern made reusable, so every page that still
   prompted can ask the same way.

   USE
   ---
     CESTISForm.ask({
       title: 'Edit message',
       intro: 'optional line under the title',
       fields: [{ name, label, type: 'text'|'textarea'|'number'|'select'|'password',
                  value, required, maxlength, min, max, step, placeholder,
                  hint, options: [{ value, label }], autocomplete }],
       submitLabel: 'Save', cancelLabel: 'Cancel', danger: false,
       validate: function (values) { return '' or 'what is wrong' }
     }).then(function (values) { if (!values) return;  // cancelled
       ...exactly what the prompt's answer used to do... });

   values holds each field's text (trimmed for text fields; numbers stay as
   the typed text, already checked to be a number). Nothing is ever written
   into the page as HTML: every label, value and message is set as text.
   Escape or Cancel resolves null; clicking beside the box does nothing (it
   used to be easy to lose what was typed that way). Enter submits from a
   one-line field, Ctrl+Enter from a text area. Tab stays inside the dialog,
   and focus goes back to where it was.
   ============================================================================ */
(function (root) {
  'use strict';
  var doc = root.document;
  var CSS =
    '.cestis-form-overlay{position:fixed;inset:0;z-index:13000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:12px;' +
      '-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);font-family:"DM Sans",system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '.cestis-form-box{background:#141b24;color:#e8edf3;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:24px 24px 20px;width:100%;max-width:460px;' +
      'max-height:calc(100vh - 24px);overflow-y:auto;box-shadow:0 18px 48px rgba(0,0,0,.5);text-align:left;box-sizing:border-box}' +
    '.cestis-form-box *{box-sizing:border-box}' +
    '.cestis-form-box h3{margin:0 0 6px;font:600 19px/1.3 "Playfair Display",Georgia,serif;color:#e8edf3}' +
    '.cestis-form-intro{margin:0 0 16px;font-size:13px;line-height:1.5;color:#8899aa;white-space:pre-line}' +
    '.cestis-form-field{margin:0 0 14px}' +
    '.cestis-form-field label{display:block;margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#8899aa}' +
    '.cestis-form-field input,.cestis-form-field select,.cestis-form-field textarea{display:block;width:100%;margin:0;background:#0f1820;color:#e8edf3;' +
      'border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:10px 14px;font:400 14px/1.4 "DM Sans",system-ui,sans-serif;outline:none}' +
    '.cestis-form-field textarea{min-height:90px;resize:vertical}' +
    '.cestis-form-field input:focus,.cestis-form-field select:focus,.cestis-form-field textarea:focus{border-color:#f0a500;box-shadow:0 0 0 2px rgba(240,165,0,.2)}' +
    '.cestis-form-field input[aria-invalid="true"],.cestis-form-field select[aria-invalid="true"],.cestis-form-field textarea[aria-invalid="true"]{border-color:rgba(231,76,60,.75)}' +
    '.cestis-form-hint{margin-top:5px;font-size:12px;color:#8293a7}' +
    '.cestis-form-error{margin:0 0 12px;padding:9px 11px;border-radius:8px;background:rgba(231,76,60,.15);border:1px solid rgba(231,76,60,.45);color:#ffb4ab;font-size:12.5px;line-height:1.45}' +
    '.cestis-form-error[hidden]{display:none}' +
    '.cestis-form-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:18px}' +
    '.cestis-form-actions button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:9px 18px;border-radius:8px;cursor:pointer;' +
      'font:600 13px/1.2 "DM Sans",system-ui,sans-serif;border:1px solid transparent}' +
    '.cestis-form-actions .cf-cancel{background:rgba(255,255,255,.06);color:#e8edf3;border-color:rgba(255,255,255,.12)}' +
    '.cestis-form-actions .cf-cancel:hover{background:rgba(255,255,255,.1)}' +
    '.cestis-form-actions .cf-submit{background:linear-gradient(135deg,#f0a500,#d4900a);color:#000}' +
    '.cestis-form-actions .cf-submit.cf-danger{background:#c0392b;color:#fff}' +
    '.cestis-form-box button:focus-visible,.cestis-form-box input:focus-visible,.cestis-form-box select:focus-visible,.cestis-form-box textarea:focus-visible{outline:2px solid #f0a500;outline-offset:2px}' +
    '@media (max-width:600px){.cestis-form-box{padding:20px 16px 16px}.cestis-form-field input,.cestis-form-field select,.cestis-form-field textarea{font-size:16px}' +
      '.cestis-form-actions button{flex:1 1 0}}';

  var seq = 0;
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function ensureCss() {
    if (doc.getElementById('cestisFormModalCss')) return;
    var st = el('style'); st.id = 'cestisFormModalCss'; st.textContent = CSS;
    (doc.head || doc.body).appendChild(st);
  }
  function focusables(box) {
    return Array.prototype.filter.call(box.querySelectorAll('button, input, select, textarea'), function (x) {
      return !x.disabled && x.getClientRects().length > 0;
    });
  }

  /* The plain checks every form gets: a required field must hold something,
     a number field a number within its limits. Returns '' or the message. */
  function checkField(f, raw) {
    var v = String(raw == null ? '' : raw);
    var label = f.label || f.name;
    if (f.required && !v.trim()) return 'Please fill in “' + label + '”.';
    if (f.type === 'number' && v.trim() !== '') {
      var n = Number(v.replace(/,/g, ''));
      if (!isFinite(n)) return '“' + label + '” must be a number (digits only, e.g. 287829.27).';
      if (f.min != null && n < f.min) return '“' + label + '” cannot be less than ' + f.min + '.';
      if (f.max != null && n > f.max) return '“' + label + '” cannot be more than ' + f.max + '.';
    }
    if (f.maxlength && v.length > f.maxlength) return '“' + label + '” is too long (' + f.maxlength + ' characters at most).';
    return '';
  }

  function ask(opts) {
    opts = opts || {};
    if (!doc || !doc.body) return Promise.resolve(null);
    ensureCss();
    var fields = Array.isArray(opts.fields) ? opts.fields : [];
    var id = 'cestisForm' + (++seq);
    var back = doc.activeElement;
    var overlay = el('div', 'cestis-form-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', id + 'Title');
    var form = el('form', 'cestis-form-box');
    form.setAttribute('novalidate', '');
    form.appendChild(el('h3', null, opts.title || 'Please fill in')).id = id + 'Title';
    if (opts.intro) { var intro = el('p', 'cestis-form-intro', opts.intro); intro.id = id + 'Intro'; form.appendChild(intro); overlay.setAttribute('aria-describedby', intro.id); }
    var inputs = {};
    fields.forEach(function (f, i) {
      var wrap = el('div', 'cestis-form-field');
      var fid = id + 'F' + i;
      var lab = el('label', null, f.label || f.name); lab.setAttribute('for', fid);
      var input;
      if (f.type === 'textarea') input = el('textarea');
      else if (f.type === 'select') {
        input = el('select');
        (f.options || []).forEach(function (o) {
          var opt = el('option', null, o.label != null ? o.label : o.value); opt.value = String(o.value); input.appendChild(opt);
        });
      } else {
        input = el('input');
        input.type = f.type === 'password' ? 'password' : 'text';
        if (f.type === 'number') { input.setAttribute('inputmode', 'decimal'); }
      }
      input.id = fid; input.name = f.name;
      if (f.value != null) input.value = String(f.value);
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.maxlength) input.maxLength = f.maxlength;
      if (f.required) input.setAttribute('aria-required', 'true');
      input.setAttribute('autocomplete', f.autocomplete || (f.type === 'password' ? 'current-password' : 'off'));
      wrap.appendChild(lab); wrap.appendChild(input);
      if (f.hint) { var h = el('div', 'cestis-form-hint', f.hint); h.id = fid + 'Hint'; input.setAttribute('aria-describedby', h.id); wrap.appendChild(h); }
      form.appendChild(wrap);
      inputs[f.name] = input;
    });
    var err = el('div', 'cestis-form-error'); err.setAttribute('role', 'alert'); err.hidden = true; err.id = id + 'Err';
    form.appendChild(err);
    var actions = el('div', 'cestis-form-actions');
    var cancel = el('button', 'cf-cancel', opts.cancelLabel || 'Cancel'); cancel.type = 'button';
    var submit = el('button', 'cf-submit' + (opts.danger ? ' cf-danger' : ''), opts.submitLabel || 'Save'); submit.type = 'submit';
    actions.appendChild(cancel); actions.appendChild(submit);
    form.appendChild(actions);
    overlay.appendChild(form);
    doc.body.appendChild(overlay);

    return new Promise(function (resolve) {
      var done = false;
      function isTop() { var all = doc.querySelectorAll('.cestis-form-overlay'); return all[all.length - 1] === overlay; }
      function close(result) {
        if (done) return;
        done = true;
        doc.removeEventListener('keydown', onKey, true);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        try { if (back && back.focus && doc.contains(back) && back !== doc.body) back.focus(); } catch (e) {}
        resolve(result);
      }
      function values() {
        var out = {};
        fields.forEach(function (f) {
          var v = inputs[f.name].value;
          out[f.name] = (f.type === 'password' || f.type === 'select') ? v : String(v).trim();
        });
        return out;
      }
      function say(msg, bad) {
        Object.keys(inputs).forEach(function (k) { inputs[k].removeAttribute('aria-invalid'); });
        if (!msg) { err.hidden = true; err.textContent = ''; return; }
        err.textContent = msg; err.hidden = false;
        if (bad) { bad.setAttribute('aria-invalid', 'true'); bad.setAttribute('aria-errormessage', err.id); try { bad.focus(); } catch (e) {} }
      }
      function onSubmit(e) {
        if (e) e.preventDefault();
        for (var i = 0; i < fields.length; i++) {
          var m = checkField(fields[i], inputs[fields[i].name].value);
          if (m) { say(m, inputs[fields[i].name]); return; }
        }
        var vals = values();
        var problem = typeof opts.validate === 'function' ? opts.validate(vals) : '';
        if (problem) {
          var which = typeof problem === 'object' ? problem : { message: problem };
          say(which.message, which.field ? inputs[which.field] : null);
          return;
        }
        close(vals);
      }
      function onKey(e) {
        if (done || !isTop()) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); return; }
        if (e.key === 'Tab') {
          var list = focusables(form);
          if (!list.length) return;
          var first = list[0], last = list[list.length - 1];
          e.stopPropagation();
          if (!form.contains(doc.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
          else if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
          return;
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target && e.target.tagName === 'TEXTAREA') { e.preventDefault(); onSubmit(); }
      }
      form.addEventListener('submit', onSubmit);
      cancel.addEventListener('click', function () { close(null); });
      Object.keys(inputs).forEach(function (k) { inputs[k].addEventListener('input', function () { if (!err.hidden) say(''); }); });
      doc.addEventListener('keydown', onKey, true);
      var firstInput = fields.length ? inputs[fields[0].name] : submit;
      setTimeout(function () {
        try { firstInput.focus(); if (firstInput.select && firstInput.tagName === 'INPUT') firstInput.select(); } catch (e) {}
      }, 0);
    });
  }

  root.CESTISForm = { ask: ask, checkField: checkField };
})(typeof window !== 'undefined' ? window : this);
