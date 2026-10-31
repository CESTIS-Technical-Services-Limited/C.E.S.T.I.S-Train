/* ============================================================================
   cestis-assessments-staff.js — prepared assessments for staff.

   Loaded only on a staff page (assessMount → cestisNeedLib('CESTISAssessStaff')),
   after cestis-assessments.js. A trainee's phone never fetches it.

     The Assessments page    each programme's units (the Qualification Plan) and
                             the four assessments of each: Prepare (from the
                             unit's bank), Preview, Check & edit (the test
                             builder; a practical's brief here), Mark Ready,
                             Open for an intake… (a copy for that intake's
                             training centre, with dates — the existing exam
                             model), the groups of a practical.
     The office copy         every completed assessment filed in the
                             Assessment Results folder (fileDue, beside the save)
     Marking a practical     a result for each member, with the checklist
     Assessment Results      the page: filters, counts, View PDF, Download,
                             several as one PDF, a group's photos (one, or all
                             as a ZIP)
   ============================================================================ */
(function () {
  'use strict';
  var W = window, S = W.CESTISAssess;
  var A = W.CESTISCore.assessments, X = W.CESTISCore.exams;
  var esc = S.esc, str = S.str, list = S.list;

  /* ---- Who is looking ------------------------------------------------ */
  function me() {
    var r = S.role();
    if (r === 'instructor' && W.currentInstructor) return { id: str(W.currentInstructor.id), name: str(W.currentInstructor.name), role: r, course: str(W.currentInstructor.course) };
    var u = W.currentLoggedInUser || {};
    return { id: str(u.id), name: str(u.name || u.username || (r === 'admin' ? 'Administrator' : 'Staff')), role: r, course: '' };
  }
  function courseMatch(a, b) {
    if (!a || !b) return false;
    if (typeof W.instructorCourseMatch === 'function' && W.instructorCourseMatch(a, b)) return true;
    var x = A.normTitle(a), y = A.normTitle(b);
    return !!x && !!y && (x.indexOf(y) !== -1 || y.indexOf(x) !== -1);
  }
  /* An instructor sees her own programme; the office sees all. */
  function ownQual(q) {
    var m = me();
    if (m.role !== 'instructor') return true;
    return courseMatch(q.skillArea, m.course) || courseMatch(q.title, m.course);
  }
  function mayCheck(q) { var m = me(); return A.mayCheck(m.role, m.role === 'instructor' ? ownQual(q) : true); }
  function asTicks() { try { return typeof W.asAccessForMe === 'function' ? W.asAccessForMe() : {}; } catch (e) { return {}; } }

  /* ---- The Centre's units and the prepared banks -------------------- */
  function catalogs() {
    var raw = null;
    try { raw = JSON.parse(W.CESTISStore.getItem('voctrain_unitCatalogs') || 'null'); } catch (e) { raw = null; }
    try { return W.CESTISCore.Transcript.ensureSeeded(Array.isArray(raw) ? raw : []); } catch (e) { return Array.isArray(raw) ? raw : []; }
  }
  var bankIndex = null, bankFiles = {};
  function loadIndex() {
    if (bankIndex) return Promise.resolve(bankIndex);
    return fetch('assessments/index.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('index ' + r.status); return r.json(); })
      .then(function (j) { bankIndex = j && Array.isArray(j.banks) ? j : { banks: [] }; return bankIndex; })
      .catch(function () { return { banks: [], failed: true }; });
  }
  function loadBank(file) {
    if (bankFiles[file]) return Promise.resolve(bankFiles[file]);
    return fetch('assessments/' + file, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('bank ' + r.status); return r.json(); })
      .then(function (b) { var c = A.checkBank(b); if (!c.ok) throw new Error(c.problems[0]); bankFiles[file] = b; return b; });
  }

  /* ---- The Assessments page ----------------------------------------- */
  var view = { prog: '', q: '', only: false, open: {} };
  function kindMeta(exam, kind) {
    if (!exam) return A.KINDS[kind].type === 'theory' ? (kind === 'theory1' ? '45 multiple choice · 2 h 30 min' : '10 essays, 15 short answers · 3 h 35 min') : 'Group task (4 or 5)';
    if (A.isPractical(exam)) return 'Group task · ' + list(exam.practical && exam.practical.photos).length + ' photos to take';
    return X.questionCount(exam) + ' questions · ' + A.minutesText(exam.duration);
  }
  function chip(st) {
    var cls = st.state === 'to-check' ? 'is-check' : st.state === 'ready' ? 'is-ready' : st.state === 'opened' ? 'is-open' : 'is-none';
    return '<span class="assess-chip ' + cls + '">' + esc(st.label) + '</span>';
  }
  function unitBlock(p, u, entry, all) {
    var q = p.qual;
    var head = '<div class="assess-unit-title">' + (u.code ? '<span class="assess-code">' + esc(u.code) + '</span>' : '') + esc(u.title) + '</div>';
    if (!entry) {
      var any = A.ORDER.some(function (k) { return !!A.masterFor(all, q, u, k); });
      if (!any) return '<div class="assess-unit">' + head + '<div class="assess-empty">No prepared assessments yet.</div></div>';
    }
    var masters = {}, missing = [];
    A.ORDER.forEach(function (k) { masters[k] = A.masterFor(all, q, u, k); if (!masters[k]) missing.push(k); });
    var canCheck = mayCheck(q);
    var prep = entry && missing.length && canCheck ? '<div class="assess-acts" style="margin-bottom:8px"><button type="button" class="btn btn-primary" data-act="prepare" data-qual="' + esc(q.id) + '" data-unit="' + esc(u.code || u.title) + '">' +
      (missing.length === 4 ? 'Prepare this unit\'s four assessments' : 'Prepare the rest (' + missing.length + ')') + '</button></div>' : '';
    var cards = A.ORDER.map(function (k) {
      var m = masters[k];
      var st = A.statusOf(m, m ? A.copiesOf(all, m.id) : []);
      var acts = [];
      if (m) {
        acts.push('<button type="button" class="btn btn-secondary" data-act="preview" data-id="' + esc(m.id) + '">Preview</button>');
        if (canCheck) acts.push('<button type="button" class="btn btn-secondary" data-act="edit" data-id="' + esc(m.id) + '">Check &amp; edit</button>');
        if (canCheck && st.state === 'to-check') acts.push('<button type="button" class="btn btn-primary" data-act="ready" data-id="' + esc(m.id) + '">Mark Ready</button>');
        if (canCheck && st.state !== 'to-check') acts.push('<button type="button" class="btn btn-primary" data-act="open" data-id="' + esc(m.id) + '">Open for an intake…</button>');
        if (canCheck && A.isPractical(m) && st.intakes.length) acts.push('<button type="button" class="btn btn-secondary" data-act="groups" data-id="' + esc(m.id) + '">Groups…</button>');
        if (canCheck && A.isPractical(m) && st.intakes.length) acts.push('<button type="button" class="btn btn-secondary" data-act="mark" data-id="' + esc(m.id) + '">Mark…</button>');
      }
      var who = m && m.assessment.ready && m.assessment.readyByName ? '<div class="assess-kind-meta">Checked by ' + esc(m.assessment.readyByName) + '</div>' : '';
      return '<div class="assess-kind"><div class="assess-kind-top"><span class="assess-kind-name">' + esc(A.KINDS[k].label) + '</span>' + chip(st) + '</div>' +
        '<div class="assess-kind-meta">' + esc(kindMeta(m, k)) + '</div>' + who + (acts.length ? '<div class="assess-acts">' + acts.join('') + '</div>' : '') + '</div>';
    }).join('');
    return '<div class="assess-unit">' + head + prep + '<div class="assess-kinds">' + cards + '</div></div>';
  }
  function renderAssessments(root) {
    S.styles();
    var all = S.exams();
    var progs = A.unitsFrom(catalogs(), { only: ownQual });
    var idx = bankIndex || { banks: [] };
    var progOpts = progs.map(function (p) { return '<option value="' + esc(p.qual.id) + '"' + (view.prog === p.qual.id ? ' selected' : '') + '>' + esc(p.qual.title) + '</option>'; }).join('');
    var counts = { ready: 0, check: 0, opened: 0, none: 0 };
    var q = A.normTitle(view.q);
    var body = progs.filter(function (p) { return !view.prog || p.qual.id === view.prog; }).map(function (p) {
      var units = p.units.filter(function (u) { return !q || A.normTitle(u.code + ' ' + u.title).indexOf(q) !== -1; });
      var rows = [], pc = { ready: 0, check: 0, banks: 0 };
      units.forEach(function (u) {
        var entry = A.matchBank(idx, p.qual, u);
        var has = A.ORDER.map(function (k) { return A.masterFor(all, p.qual, u, k); });
        has.forEach(function (m) {
          if (!m) return;
          var st = A.statusOf(m, A.copiesOf(all, m.id)).state;
          if (st === 'to-check') { counts.check++; pc.check++; } else { counts.ready++; pc.ready++; if (st === 'opened') counts.opened++; }
        });
        if (entry) pc.banks++;
        if (view.only && !entry && !has.some(Boolean)) return;
        rows.push(unitBlock(p, u, entry, all));
      });
      if (!rows.length && (q || view.only)) return '';
      var open = view.open[p.qual.id] !== false && (view.prog || progs.length <= 2 || view.open[p.qual.id] === true || !!q || view.only);
      return '<details class="card assess-prog" data-qual="' + esc(p.qual.id) + '"' + (open ? ' open' : '') + '><summary><div><h3>' + esc(p.qual.skillArea || p.qual.title) + ' — ' + esc(p.qual.title) + '</h3>' +
        '<p class="assess-sub">' + p.units.length + ' units' + (p.qual.code ? ' · ' + esc(p.qual.code) : '') + ' · prepared assessments for ' + pc.banks + ' unit' + (pc.banks === 1 ? '' : 's') + '</p></div>' +
        '<div class="assess-counts">' + (pc.ready ? '<span class="assess-chip is-ready">' + pc.ready + ' Ready</span>' : '') + (pc.check ? '<span class="assess-chip is-check">' + pc.check + ' to check</span>' : '') + '</div></summary>' +
        (rows.join('') || '<div class="assess-empty">No units match.</div>') + '</details>';
    }).join('');
    var r = me().role;
    root.innerHTML = '<div class="assess-head"><div><h2>Assessments</h2><p class="assess-sub">Theory 1, Theory 2, Practical 1 and Practical 2 for every unit. Unit names come from your Qualification Plan.</p></div>' +
      '<div class="assess-tools"><label>Programme<select class="form-control" data-ctl="prog"><option value="">All programmes</option>' + progOpts + '</select></label>' +
      '<label>Find a unit<input type="search" class="form-control" data-ctl="q" value="' + esc(view.q) + '" placeholder="Code or title"></label>' +
      '<label style="flex-direction:row;align-items:center;gap:6px;font-weight:600"><input type="checkbox" data-ctl="only"' + (view.only ? ' checked' : '') + '> Only units with prepared assessments</label></div></div>' +
      '<div class="assess-counts"><span class="assess-chip is-ready">' + counts.ready + ' Ready</span><span class="assess-chip is-check">' + counts.check + ' to check</span>' + (counts.opened ? '<span class="assess-chip is-open">' + counts.opened + ' opened</span>' : '') + '</div>' +
      '<div class="assess-note">Every prepared test starts as <strong>To check</strong>. An instructor must read it, correct anything, and mark it <strong>Ready</strong> before it can be opened for an intake. Nothing reaches trainees until then.' +
      (r === 'adminstaff' ? ' You can look at them here; instructors and the Administrator check and open them.' : '') + '</div>' +
      (idx.failed ? '<div class="assess-note" role="alert">The list of prepared assessments could not be read just now. Check the connection and open this page again.</div>' : '') +
      (body || '<div class="card assess-empty">' + (progs.length ? 'No units match.' : 'There are no units on the Qualification Plan for your programme yet.') + '</div>');
    updateBadge();
  }
  function updateBadge() {
    var n = S.exams().filter(function (e) { return A.isMaster(e) && !e.assessment.ready && (me().role !== 'instructor' || courseMatch(e.course, me().course)); }).length;
    ['assessToCheckBadge', 'iAssessToCheckBadge'].forEach(function (id) { var b = document.getElementById(id); if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; } });
  }
  function findUnit(qualId, unitKey) {
    var p = A.unitsFrom(catalogs()).filter(function (x) { return x.qual.id === qualId; })[0];
    if (!p) return null;
    var u = p.units.filter(function (x) { return (x.code || x.title) === unitKey; })[0];
    return u ? { qual: p.qual, unit: u } : null;
  }

  /* Prepare: the unit's four tests from its bank, each a draft "To check". */
  function prepare(qualId, unitKey) {
    var f = findUnit(qualId, unitKey);
    if (!f || !mayCheck(f.qual)) return;
    var entry = A.matchBank(bankIndex, f.qual, f.unit);
    if (!entry) { S.toast('There are no prepared assessments for this unit yet.', 'warning'); return; }
    return loadBank(entry.file).then(function (bank) {
      var m = me(), at = S.nowIso(), made = 0;
      A.ORDER.forEach(function (k) {
        if (A.masterFor(S.exams(), f.qual, f.unit, k)) return;
        var ex = A.bankToExam(bank, k, { id: S.gen('EXAM-'), qual: f.qual, unit: f.unit, programme: f.qual.skillArea || bank.programme, bankRef: entry.file,
          by: m.role === 'instructor' ? m.id : (m.role === 'admin' ? 'admin' : m.id), byRole: m.role, at: at });
        if (!ex) return;
        W.exams.unshift(ex);
        made++;
      });
      S.saveExams();
      S.toast(made ? 'Prepared ' + made + ' assessment' + (made === 1 ? '' : 's') + ' — each is To check until an instructor marks it Ready.' : 'Already prepared.');
      rerender();
    }, function () { S.toast('The prepared assessments for this unit could not be read just now. Try again.', 'error'); });
  }

  /* Preview: the paper with its answers, for whoever checks it. */
  function preview(id) {
    var e = S.examById(id);
    if (!e) return;
    var body;
    if (A.isPractical(e)) {
      var p = e.practical || {};
      var li = function (arr) { return '<ul class="assess-todo">' + list(arr).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; };
      body = '<p style="white-space:pre-wrap;line-height:1.55">' + esc(p.brief) + '</p>' + (p.time ? '<p><strong>Time:</strong> ' + esc(p.time) + '</p>' : '') +
        '<h4>Materials</h4>' + li(p.materials) + '<h4>Photos to take</h4>' + li(p.photos) + '<h4>What the assessor checks (for each member)</h4>' + li(p.checklist) + '<h4>Safety</h4>' + li(p.safety);
    } else {
      var n = 0;
      body = '<p class="assess-sub">' + esc(e.instructions || '') + '</p>' + list(e.questionData).map(function (q) {
        if (q.type === 'info') return '<h4 style="margin:14px 0 4px">' + esc(q.text) + '</h4>';
        n++;
        var inner = '';
        if (q.type === 'mcq') inner = '<ol type="a">' + list(q.options).map(function (o, i) { return '<li' + (i === q.correctAnswer ? ' class="is-key"' : '') + '>' + esc(o) + (i === q.correctAnswer ? ' — right answer' : '') + '</li>'; }).join('') + '</ol>';
        else if (q.type === 'shortanswer') inner = '<div class="assess-model">Accepted answers: ' + esc(X.acceptedAnswers(q.correctAnswer).join(' / ')) + (q.manualIfNoMatch ? '. Any other answer waits for marking.' : '') + '</div>';
        else if (q.type === 'essay') inner = (q.modelAnswer ? '<div class="assess-model"><strong>Model answer:</strong> ' + esc(q.modelAnswer) + '</div>' : '') +
          (list(q.markingPoints).length ? '<div class="assess-model"><strong>Marking points:</strong><br>' + list(q.markingPoints).map(function (m) { return '• ' + esc(m); }).join('<br>') + '</div>' : '');
        return '<div class="assess-q"><span class="assess-q-n">' + n + '.</span>' + esc(q.text) + ' <span class="assess-sid">(' + esc(q.points) + ' mark' + (q.points == 1 ? '' : 's') + ')</span>' + inner + '</div>';
      }).join('');
    }
    S.dialog({ title: 'Preview — ' + e.title, body: body, wide: true, actions: [{ id: 'close2', label: 'Close', close: true }] });
  }

  /* Check & edit: the test builder for a theory test; the brief here for a practical. */
  function edit(id) {
    var e = S.examById(id);
    if (!e) return;
    if (!A.isPractical(e)) { if (typeof W.editExam === 'function') W.editExam(e.id); return; }
    var p = e.practical || {};
    var lines = function (a) { return list(a).join('\n'); };
    var d = S.dialog({ title: 'Check & edit — ' + e.title, wide: true,
      body: '<div class="assess-err" hidden></div>' +
        '<label class="assess-field">Task title<input class="form-control" data-f="title" maxlength="200" value="' + esc(p.title) + '"></label>' +
        '<label class="assess-field">Task brief (what the group does)<textarea class="form-control" data-f="brief" rows="6">' + esc(p.brief) + '</textarea></label>' +
        '<label class="assess-field">Time allowed<input class="form-control" data-f="time" maxlength="60" value="' + esc(p.time) + '"></label>' +
        '<div class="assess-row2"><label class="assess-field">Materials (one a line)<textarea class="form-control" data-f="materials" rows="5">' + esc(lines(p.materials)) + '</textarea></label>' +
        '<label class="assess-field">Photos to take (one a line)<textarea class="form-control" data-f="photos" rows="5">' + esc(lines(p.photos)) + '</textarea></label></div>' +
        '<label class="assess-field">What the assessor checks for each member (one a line, at least 3)<textarea class="form-control" data-f="checklist" rows="7">' + esc(lines(p.checklist)) + '</textarea></label>' +
        '<label class="assess-field">Safety points (one a line)<textarea class="form-control" data-f="safety" rows="5">' + esc(lines(p.safety)) + '</textarea></label>',
      actions: [{ id: 'cancel', label: 'Cancel', close: true }, { id: 'save', label: 'Save', kind: 'primary' }],
      onAction: function (act, dl) {
        if (act !== 'save') return;
        var v = function (f) { return str(dl.q('[data-f="' + f + '"]').value); };
        var arr = function (f) { return v(f).split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean); };
        var np = A.practicalBrief({ title: v('title'), brief: v('brief'), time: v('time'), materials: arr('materials'), photos: arr('photos'), checklist: arr('checklist'), safety: arr('safety') });
        if (!np.title || !np.brief) return dl.error('The task needs a title and a brief.');
        if (!np.photos.length) return dl.error('List at least one photo for the group to take.');
        if (np.checklist.length < 3) return dl.error('List at least three things the assessor checks.');
        if (!np.safety.length) return dl.error('List at least one safety point.');
        if ([np.title, np.brief].concat(np.materials, np.photos, np.checklist, np.safety).some(function (x) { return /[<>]/.test(x); })) return dl.error('Please leave out the < and > signs.');
        e.practical = np; e.instructions = np.brief;
        S.saveExams();
        dl.close();
        S.toast('Saved.');
        rerender();
      } });
    return d;
  }

  function markReady(id) {
    var e = S.examById(id);
    if (!e || !A.isMaster(e)) return;
    var f = { skillArea: e.assessment.programme, title: e.assessment.qualTitle, id: e.assessment.qualId };
    if (!mayCheck(f)) return;
    if (!A.isPractical(e)) {
      var bad = X.keyProblems(e.questionData);
      if (bad.length) { S.toast('Question ' + bad.join(', ') + ' needs its answer set before this test can be Ready. Use Check & edit.', 'warning'); return; }
    }
    S.confirm('Mark Ready', 'Have you read every question and answer of "' + e.title + '" and corrected anything wrong? Once it is Ready it can be opened for an intake.', 'Mark Ready').then(function (ok) {
      if (!ok) return;
      A.markReady(e, me(), S.nowIso());
      S.saveExams();
      S.toast('Ready. It can now be opened for an intake.');
      rerender();
    });
  }

  /* The training centres (intakes) of a programme, newest first. */
  function intakesFor(e) {
    var prog = e.assessment.programme || e.course;
    var centres = list(W.skillAreas).filter(function (c) { return c && c.name; });
    var label = function (c) { try { return W.CESTISCore.enrolment.centreLabel(c) || c.name; } catch (x) { return c.name; } };
    var mine = centres.filter(function (c) { return courseMatch(label(c), prog) || courseMatch(c.name, prog); });
    var out = (mine.length ? mine : centres).map(function (c) {
      var lab = label(c);
      var months = A.intakeLabel({ startDate: c.startDate, endDate: c.endDate });
      return { id: str(c.id), course: lab, label: months && months !== lab ? lab + ' (' + months + ')' : lab, intake: months || lab };
    });
    return out;
  }
  function openForIntake(id) {
    var e = S.examById(id);
    if (!e || !A.isMaster(e)) return;
    if (!e.assessment.ready) { S.toast('Mark it Ready first.', 'warning'); return; }
    var intakes = intakesFor(e);
    var off = S.offset();
    var start = X.defaultStart(Date.now() + 86400000, off);
    var practical = A.isPractical(e);
    var closeDay = practical ? X.centreParts(Date.now() + 5 * 86400000, off).date : start.date;
    var endTime = practical ? '16:00' : (function () { var t = start.time.split(':').map(Number), m = t[0] * 60 + t[1] + (Number(e.duration) || 150) + 60; m = Math.min(m, 23 * 60 + 59); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); })();
    S.dialog({ title: 'Open for an intake — ' + A.KINDS[e.assessment.kind].label, wide: false,
      body: '<p class="assess-sub" style="margin-bottom:12px">' + esc(e.title) + '</p><div class="assess-err" hidden></div>' +
        '<label class="assess-field">Intake<select class="form-control" data-f="intake">' + intakes.map(function (c, i) { return '<option value="' + i + '">' + esc(c.label) + '</option>'; }).join('') + '</select></label>' +
        '<div class="assess-row2"><label class="assess-field">Opens on<input type="date" class="form-control" data-f="date" value="' + esc(start.date) + '"></label>' +
        '<label class="assess-field">at<input type="time" class="form-control" data-f="time" value="' + esc(start.time) + '"></label></div>' +
        '<div class="assess-row2"><label class="assess-field">Closes on<input type="date" class="form-control" data-f="closeDate" value="' + esc(closeDay) + '"></label>' +
        '<label class="assess-field">at<input type="time" class="form-control" data-f="closeTime" value="' + esc(endTime) + '"></label></div>' +
        (practical ? '' : '<label class="assess-consent" style="font-size:13px"><input type="checkbox" data-f="invig" checked> <span>This sitting is invigilated (watched on the invigilator page). Its records say so.</span></label>') +
        '<p class="assess-sub">' + (practical ? 'Groups can add photos and hand in between these times. Make the groups next (Groups…).' :
          'Trainees can start the test between these times; each has ' + esc(A.minutesText(e.duration)) + ' from when she starts, but never past the closing time.') + '</p>',
      actions: [{ id: 'cancel', label: 'Cancel', close: true }, { id: 'open', label: 'Open it', kind: 'primary' }],
      onAction: function (act, dl) {
        if (act !== 'open') return;
        var c = intakes[Number(dl.q('[data-f="intake"]').value)];
        if (!c) return dl.error('Choose an intake.');
        var m = me();
        var o = A.openCopy(e, { id: S.gen('EXAM-'), course: c.course, intake: c.intake, centreId: c.id, date: dl.q('[data-f="date"]').value, time: dl.q('[data-f="time"]').value,
          closeDate: dl.q('[data-f="closeDate"]').value, closeTime: dl.q('[data-f="closeTime"]').value, by: m.role === 'instructor' ? m.id : (m.role === 'admin' ? 'admin' : m.id),
          byRole: m.role, byName: m.name, at: S.nowIso(), offset: off, invigilated: practical ? undefined : !!(dl.q('[data-f="invig"]') || {}).checked });
        var why = { 'no-date': 'Choose the day and time it opens.', 'no-close': 'Choose the day it closes.', 'close-before-open': 'It must close after it opens.', 'not-ready': 'Mark it Ready first.', 'no-intake': 'Choose an intake.' };
        if (o.error) return dl.error(why[o.error] || 'It could not be opened.');
        W.exams.unshift(o.exam);
        S.saveExams();
        try { if (typeof W.addNotification === 'function') W.addNotification('Assessment opened: "' + o.exam.title + '" for ' + c.label, 'exam', null, ['admin', 'instructor']); } catch (x) {}
        dl.close();
        S.toast('Opened for ' + c.intake + '.' + (practical ? ' Now make the groups.' : ''));
        rerender();
        if (practical) groups(o.exam.id);
      } });
  }

  /* ---- Groups of 4 or 5 for an opened practical ---------------------- */
  function rosterFor(e) {
    var stage = function (s) { var st = str(s.stage).toLowerCase(); return !st || st === 'training' || st === 'in training'; };
    return list(W.students).filter(function (s) { return s && s.id != null && stage(s) && (s.course === e.course || courseMatch(s.course, e.course)); })
      .map(function (s) { return { id: str(s.id), name: str(s.name) }; });
  }
  function groups(id) {
    var e = S.examById(id);
    if (!e) return;
    var opened = A.isMaster(e) ? A.copiesOf(S.exams(), e.id) : [e];
    if (!opened.length) { S.toast('Open it for an intake first.', 'warning'); return; }
    var ex = opened[0];
    var pick = opened.length > 1 ? '<label class="assess-field">Intake<select class="form-control" data-f="copy">' + opened.map(function (c, i) { return '<option value="' + i + '">' + esc(c.assessment.intake || c.course) + '</option>'; }).join('') + '</select></label>' : '';
    var state = { ex: ex, assign: {} };
    var d = S.dialog({ title: 'Groups — ' + A.KINDS[ex.assessment.kind].label, wide: true,
      body: pick + '<div data-g="body"></div>',
      actions: [{ id: 'auto', label: 'Split the register into 4s and 5s' }, { id: 'cancel', label: 'Cancel', close: true }, { id: 'save', label: 'Save the groups', kind: 'primary' }],
      onAction: function (act, dl) {
        if (act === 'auto') {
          var sp = A.splitGroups(rosterFor(state.ex));
          state.assign = {};
          sp.groups.forEach(function (g, i) { g.forEach(function (sid) { state.assign[sid] = i; }); });
          state.n = sp.groups.length; state.note = sp.note;
          draw(dl);
          return;
        }
        if (act === 'save') save(dl);
      } });
    d.el.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.getAttribute('data-f') === 'copy') { state.ex = opened[Number(t.value)]; load(); draw(d); }
      if (t.getAttribute('data-sid')) { state.assign[t.getAttribute('data-sid')] = t.value === '' ? -1 : Number(t.value); if (Number(t.value) >= state.n) state.n = Number(t.value) + 1; draw(d); }
    });
    function load() {
      state.assign = {}; state.n = 0; state.note = '';
      A.groupsOf(S.work(), state.ex.id).forEach(function (g, i) { g.members.forEach(function (sid) { state.assign[sid] = i; }); state.n = i + 1; });
      state.existing = A.groupsOf(S.work(), state.ex.id);
    }
    function draw(dl) {
      var roll = rosterFor(state.ex);
      var known = {};
      roll.forEach(function (p) { known[p.id] = 1; });
      Object.keys(state.assign).forEach(function (sid) { if (!known[sid]) { var st = S.studentById(sid); roll.push({ id: sid, name: st ? st.name : sid }); } });
      roll.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      var n = Math.max(state.n || 0, 1);
      var groupsNow = [];
      for (var i = 0; i < n + 1; i++) groupsNow.push([]);
      roll.forEach(function (p) { var g = state.assign[p.id]; if (g != null && g >= 0) groupsNow[g].push(p.id); });
      var probs = A.groupProblems(groupsNow.slice(0, n).map(function (m, i) { return { name: A.groupName(i), members: m }; }), roll.map(function (p) { return p.id; }));
      var opts = function (sel) { var o = '<option value="">No group</option>'; for (var i = 0; i < n + 1; i++) o += '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + esc(A.groupName(i)) + (i === n ? ' (new)' : '') + '</option>'; return o; };
      dl.q('[data-g="body"]').innerHTML = '<p class="assess-sub">' + esc(state.ex.title) + ' · ' + esc(state.ex.assessment.intake || state.ex.course) + '. Groups of 4 or 5. Choose a group for each trainee, or press <strong>Split the register into 4s and 5s</strong> and change what you need.</p>' +
        (state.note ? '<div class="assess-note">' + esc(state.note) + '</div>' : '') +
        (probs.length ? '<div class="assess-note">' + probs.map(function (p) { return esc(p.kind === 'missing' ? (S.studentById(p.studentId) || {}).name + ' is in no group.' : p.text); }).join('<br>') + '</div>' : '') +
        '<div class="table-wrapper"><table class="assess-table"><thead><tr><th>Trainee</th><th>Group</th></tr></thead><tbody>' +
        roll.map(function (p) { var g = state.assign[p.id]; return '<tr><td>' + esc(p.name) + ' <span class="assess-sid">' + esc(p.id) + '</span></td><td><select class="form-control" data-sid="' + esc(p.id) + '" aria-label="Group for ' + esc(p.name) + '">' + opts(g == null ? -1 : g) + '</select></td></tr>'; }).join('') +
        '</tbody></table></div>' + (roll.length ? '' : '<p class="assess-empty">Nobody in training is on this intake\'s register yet.</p>');
    }
    function save(dl) {
      var at = S.nowIso(), m = me(), recs = [];
      var byIdx = {};
      Object.keys(state.assign).forEach(function (sid) { var g = state.assign[sid]; if (g != null && g >= 0) (byIdx[g] = byIdx[g] || []).push(sid); });
      var existing = A.groupsOf(S.work(), state.ex.id);
      var used = {};
      Object.keys(byIdx).map(Number).sort(function (a, b) { return a - b; }).forEach(function (gi, k) {
        var name = A.groupName(k);
        var prev = existing.filter(function (g) { return g.name === name; })[0];
        var rec = A.makeGroup({ id: prev ? prev.id : S.gen('AG-'), examId: state.ex.id, name: name, members: byIdx[gi], by: m.id, byName: m.name, at: at });
        if (prev) { rec.createdBy = prev.createdBy; rec.createdByName = prev.createdByName; rec.createdAt = prev.createdAt; }
        used[rec.id] = 1;
        recs.push(rec);
      });
      // A group no longer used is marked withdrawn — kept, never deleted. One
      // that already has photos or has handed in is kept as it is.
      var kept = [];
      existing.forEach(function (g) {
        if (used[g.id]) return;
        var st = A.groupState(g, S.work());
        if (st && (st.photos.length || st.handedIn)) { kept.push(g.name); return; }
        var w = JSON.parse(JSON.stringify(g)); w.withdrawn = true; w.updatedAt = at; recs.push(w);
      });
      S.saveWork(recs);
      dl.close();
      S.toast('Groups saved. Each member sees her group on My Assessments.' + (kept.length ? ' ' + kept.join(', ') + ' already has photos, so it was kept.' : ''));
      rerender();
    }
    load(); draw(d);
  }

  /* ---- Add time (the owner: "the Administrator should be able to add time
     if needed") — for one trainee or the whole sitting, before it starts or
     while it is sat. Who, how much and why are kept on the exam
     (Core.exams.extraGrantsFor); nothing is ever taken back. ------------ */
  function mayAddTime() { var m = me(); return A.mayAddTime(m.role, m.role === 'adminstaff' ? asTicks() : null); }
  function addTime(examId, studentId) {
    var e = S.examById(examId);
    if (!e) return;
    if (!mayAddTime()) { S.toast('Only the Administrator, and Admin Staff with Online Exams, can add time.', 'warning'); return; }
    var roll = rosterFor(e);
    list(W.examAttempts).forEach(function (a) { if (a && str(a.examId) === str(e.id) && !roll.some(function (p) { return p.id === str(a.studentId); })) { var st = S.studentById(a.studentId); roll.push({ id: str(a.studentId), name: st ? st.name : str(a.studentName || a.studentId) }); } });
    roll.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    var nm = {}; roll.forEach(function (p) { nm[p.id] = p.name; });
    var given = X.extraGrantsFor ? list(e.extraTime) : [];
    var past = given.length ? '<div class="assess-note" style="margin-top:10px"><strong>Already added</strong><br>' + given.map(function (g) {
      return esc(A.minutesText(g.minutes)) + ' for ' + esc(g.studentId ? (nm[g.studentId] || g.studentId) : 'the whole sitting') + ' — ' + esc(g.reason) + ' — by ' + esc(g.byName) + ' (' + esc(A.roleLabel(g.byRole).replace(/^the /, '')) + '), ' + esc(A.when(g.at, S.offset()));
    }).join('<br>') + '</div>' : '';
    S.dialog({ title: 'Add time', body: '<p class="assess-sub" style="margin-bottom:12px">' + esc(e.title) + '</p><div class="assess-err" hidden></div>' +
      '<label class="assess-field">For<select class="form-control" data-f="who"><option value="">The whole sitting (everyone)</option>' +
        roll.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === str(studentId) ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="assess-field">Minutes to add<input type="number" class="form-control" data-f="min" min="1" max="' + A.GRANT_MAX_MIN + '" step="1" value="15" inputmode="numeric"></label>' +
      '<div class="assess-acts" style="margin:-4px 0 12px">' + [5, 10, 15, 30].map(function (n) { return '<button type="button" class="btn btn-secondary" data-min="' + n + '">' + n + ' min</button>'; }).join('') + '</div>' +
      '<label class="assess-field">Why<input type="text" class="form-control" data-f="why" maxlength="200" placeholder="For example: power cut at home"></label>' +
      '<p class="assess-sub">The trainee\'s clock shows the new time within a minute or two, at home too. Her printed record says "Extra time: … added by ' + esc(A.roleLabel(me().role)) + '".</p>' + past,
      actions: [{ id: 'cancel', label: 'Cancel', close: true }, { id: 'add', label: 'Add time', kind: 'primary' }],
      onAction: function (act, dl, ev) {
        if (act !== 'add') return;
        var m = me();
        var g = A.makeGrant({ id: S.gen('XT-'), studentId: dl.q('[data-f="who"]').value, minutes: Number(dl.q('[data-f="min"]').value), reason: dl.q('[data-f="why"]').value,
          byId: m.id, byName: m.name, byRole: m.role, at: S.nowIso() });
        if (g.error) return dl.error(g.error === 'minutes' ? 'Minutes: a whole number from 1 to ' + A.GRANT_MAX_MIN + '.' : g.error === 'reason' ? 'Say why the time is added (plain words).' : 'Sign in again to add time.');
        A.addGrant(e, g.grant);
        S.saveExams();
        try { if (typeof W.gatePublishSoon === 'function') W.gatePublishSoon(); } catch (x) {}
        dl.close();
        var who = g.grant.studentId ? (nm[g.grant.studentId] || 'the trainee') : 'everyone in the sitting';
        S.toast(A.minutesText(g.grant.minutes) + ' added for ' + who + '. The clock shows it within a minute or two.');
        try { if (typeof W.invigRender === 'function') W.invigRender(); } catch (x) {}
      } });
    var last = document.querySelector('.assess-dlg-back:last-of-type');
    if (last) last.addEventListener('click', function (ev) { var b = ev.target.closest('[data-min]'); if (b) last.querySelector('[data-f="min"]').value = b.getAttribute('data-min'); });
  }

  /* ---- Page plumbing ------------------------------------------------- */
  function rerender() { var root = S.rootFor('assessments'); if (root) renderAssessments(root); }
  function bindAssessments(root) {
    if (root._assessBound) return;
    root._assessBound = true;
    root.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]');
      if (!b || !root.contains(b)) return;
      var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
      if (act === 'prepare') prepare(b.getAttribute('data-qual'), b.getAttribute('data-unit'));
      else if (act === 'preview') preview(id);
      else if (act === 'edit') edit(id);
      else if (act === 'ready') markReady(id);
      else if (act === 'open') openForIntake(id);
      else if (act === 'groups') groups(id);
      else if (act === 'mark') markPractical(id);
    });
    root.addEventListener('toggle', function (ev) {
      var d = ev.target;
      if (d && d.matches && d.matches('details[data-qual]')) view.open[d.getAttribute('data-qual')] = d.open;
    }, true);
    var timer = null;
    root.addEventListener('input', function (ev) {
      var c = ev.target.getAttribute('data-ctl');
      if (c === 'q') { view.q = ev.target.value; clearTimeout(timer); timer = setTimeout(function () { var pos = ev.target.selectionStart; renderAssessments(root); var el = root.querySelector('[data-ctl="q"]'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) {} } }, 250); }
    });
    root.addEventListener('change', function (ev) {
      var c = ev.target.getAttribute('data-ctl');
      if (c === 'prog') { view.prog = ev.target.value; renderAssessments(root); }
      if (c === 'only') { view.only = ev.target.checked; renderAssessments(root); }
    });
  }

  /* ==================================================================
     THE OFFICE COPY (the owner's decision 8). An office PC (the
     Administrator's, or Admin Staff's) files every completed assessment in
     the staff-only "Assessment Results" folder once its result is here:
     Programme / Intake / Unit / Theory 1 / "<Full Name> (<STU-id>) — <Unit>
     Theory 1.pdf"; a practical in its "Group B" folder with the group's
     paper and its photos (copied where they are kept — nothing uploaded
     again). Her own copy goes into her own folder of the trainee gate where
     she has one, for her to download from home. Marked later: the final
     paper replaces the provisional one in the same file, and every version
     is kept with it (keepRevisionForever). The folder is made the first
     time it is needed; its id is kept in the Centre's settings (as the
     Backups folder's). Nothing here deletes or empties anything.
     ================================================================== */
  var API = 'https://www.googleapis.com/drive/v3', UP = 'https://www.googleapis.com/upload/drive/v3/files';
  var FOLDER_MIME = 'application/vnd.google-apps.folder';
  var FIELDS = 'id,name,parents,createdTime,modifiedTime,appProperties,trashed,size,mimeType';
  var ROOT_MARK = 'cestisAssessResults', KEY_MARK = 'cestisAssessKey';
  var MEMBER_PHOTOS_MAX = 6 * 1024 * 1024;   // a member's own copy carries the photos up to this (her phone reads it)
  function canReach() { return !!(W.isCloudConnected && W.googleAccessToken) && !S.gateSession(); }
  function q1(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  function olderFirst(a, b) {
    var ta = Date.parse(a.createdTime || '') || 0, tb = Date.parse(b.createdTime || '') || 0;
    return ta !== tb ? ta - tb : (String(a.id) < String(b.id) ? -1 : 1);
  }
  function call(url, init) {
    init = init || {};
    init.headers = Object.assign({ Authorization: 'Bearer ' + W.googleAccessToken }, init.headers || {});
    return fetch(url, init).then(function (r) {
      if (r.ok) return r;
      return r.json().catch(function () { return null; }).then(function (body) {
        var err = new Error('HTTP ' + r.status);
        err.status = r.status;
        try { if (r.status === 403 && W.CESTISCore.backups.quotaExceeded(body)) { err.storageFull = true; W.cestisNoteStorageFull('assessments'); } } catch (e) {}
        throw err;
      });
    });
  }
  function multipart(meta, bytes, mime) {
    var b = 'cestisassess' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    return { type: 'multipart/related; boundary=' + b,
      body: new Blob(['--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + b + '\r\nContent-Type: ' + mime + '\r\n\r\n', bytes, '\r\n--' + b + '--']) };
  }
  var json = function (r) { return r.json(); };
  var Files = {
    list: function (q) {
      var out = [], pages = 0;
      var step = function (token) {
        return call(API + '/files?q=' + encodeURIComponent(q) + '&fields=' + encodeURIComponent('nextPageToken,files(' + FIELDS + ')') + '&pageSize=200' + (token ? '&pageToken=' + encodeURIComponent(token) : ''))
          .then(json).then(function (d) {
            list(d.files).forEach(function (f) { out.push(f); });
            return d.nextPageToken && ++pages < 20 ? step(d.nextPageToken) : out;
          });
      };
      return step('');
    },
    get: function (id, fields) { return call(API + '/files/' + encodeURIComponent(id) + '?fields=' + encodeURIComponent(fields || FIELDS)).then(json); },
    bytes: function (id) { return call(API + '/files/' + encodeURIComponent(id) + '?alt=media', { cache: 'no-store' }).then(function (r) { return r.arrayBuffer(); }); },
    folder: function (meta) { return call(API + '/files?fields=' + encodeURIComponent(FIELDS), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) }).then(json); },
    copy: function (id, meta) { return call(API + '/files/' + encodeURIComponent(id) + '/copy?fields=' + encodeURIComponent(FIELDS), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) }).then(json); },
    rename: function (id, meta) { return call(API + '/files/' + encodeURIComponent(id) + '?fields=' + encodeURIComponent(FIELDS), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) }).then(json); },
    // Every version kept for good: keepRevisionForever on each upload.
    create: function (meta, bytes, mime) {
      var m = multipart(meta, bytes, mime);
      return call(UP + '?uploadType=multipart&keepRevisionForever=true&fields=' + encodeURIComponent(FIELDS), { method: 'POST', headers: { 'Content-Type': m.type }, body: m.body }).then(json);
    },
    replace: function (id, meta, bytes, mime) {
      var m = multipart(meta, bytes, mime);
      return call(UP + '/' + encodeURIComponent(id) + '?uploadType=multipart&keepRevisionForever=true&fields=' + encodeURIComponent(FIELDS), { method: 'PATCH', headers: { 'Content-Type': m.type }, body: m.body }).then(json);
    }
  };

  /* The "Assessment Results" folder, beside the backup folders (as the
     Backups folder is). Only a folder this system made (its mark). Two PCs
     making it at once: the oldest is used. create false: only look. */
  async function rootFolder(create) {
    var remember = function (id) {
      try { W.cestisThisPcWrite('cestisThisPc_assessFolder', id); } catch (e) {}
      if (S.role() === 'admin' && W.systemSettings && W.systemSettings.assessmentResultsFolderId !== id) {
        W.systemSettings.assessmentResultsFolderId = id;
        try { W.saveState(); } catch (e) {}
      }
      return id;
    };
    var known = (W.systemSettings && W.systemSettings.assessmentResultsFolderId) || (typeof W.cestisThisPcRead === 'function' ? W.cestisThisPcRead('cestisThisPc_assessFolder', '') : '');
    if (known) {
      try { var kf = await Files.get(known, 'id,trashed'); if (kf && kf.id && !kf.trashed) return remember(kf.id); }
      catch (e) { if (e.status !== 404) throw e; }
    }
    var main = W.MASTER_SNAPSHOT_CONFIG && W.MASTER_SNAPSHOT_CONFIG.FOLDER_ID, parent = main;
    if (!main) return null;
    try { var mf = await Files.get(main, 'id,parents'); if (mf && Array.isArray(mf.parents) && mf.parents[0]) parent = mf.parents[0]; }
    catch (e) { if (e.status !== 404) throw e; }
    var q = "name = '" + q1(A.ROOT_FOLDER) + "' and mimeType = '" + FOLDER_MIME + "' and '" + q1(parent) + "' in parents and trashed = false" +
      " and appProperties has { key='" + ROOT_MARK + "' and value='1' }";
    var found = (await Files.list(q)).sort(olderFirst);
    if (found.length) return remember(found[0].id);
    if (!create) return null;
    var app = {}; app[ROOT_MARK] = '1';
    await Files.folder({ name: A.ROOT_FOLDER, mimeType: FOLDER_MIME, parents: [parent], appProperties: app,
      description: 'Every completed assessment\'s record, by programme, intake and unit. For staff only.' });
    found = (await Files.list(q)).sort(olderFirst);
    return found.length ? remember(found[0].id) : null;
  }
  var folderIds = {};
  async function folderFor(path) {
    var id = await rootFolder(true);
    if (!id) throw new Error('no-folder');
    for (var i = 1; i < path.length; i++) {
      var k = id + '/' + path[i];
      if (folderIds[k]) { id = folderIds[k]; continue; }
      var q = "name = '" + q1(path[i]) + "' and mimeType = '" + FOLDER_MIME + "' and '" + q1(id) + "' in parents and trashed = false";
      var found = (await Files.list(q)).sort(olderFirst);
      if (!found.length) {
        await Files.folder({ name: path[i], mimeType: FOLDER_MIME, parents: [id], appProperties: { cestisAssess: 'folder' } });
        found = (await Files.list(q)).sort(olderFirst);
      }
      if (!found.length) throw new Error('no-folder');
      id = folderIds[k] = found[0].id;
    }
    return id;
  }
  /* A file of ours in a folder, found by its key (whichever PC made it);
     its content replaced (the old version kept), or made. */
  async function findByKey(folderId, key) {
    var q = "'" + q1(folderId) + "' in parents and trashed = false and appProperties has { key='" + KEY_MARK + "' and value='" + q1(key) + "' }";
    return (await Files.list(q)).sort(olderFirst);
  }
  async function liveId(id, fields) {
    if (!id) return null;
    try { var f = await Files.get(id, fields || 'id,name,trashed'); return f && f.id && !f.trashed ? f : null; }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async function putFile(folderId, key, kind, name, bytes, mime, knownId) {
    var app = { cestisAssess: kind }; app[KEY_MARK] = key;
    var f = await liveId(knownId);
    if (!f) f = (await findByKey(folderId, key))[0] || null;
    if (f) { await Files.replace(f.id, { name: name, appProperties: app }, bytes, mime); return f.id; }
    var made = await Files.create({ name: name, mimeType: mime, parents: [folderId], appProperties: app }, bytes, mime);
    var again = await findByKey(folderId, key);
    return again.length ? again[0].id : made.id;
  }
  // A photo: copied where it is kept into the group's folder (no upload).
  async function putPhoto(folderId, p, knownId) {
    var key = 'photo:' + p.id;
    var f = await liveId(knownId);
    if (!f) f = (await findByKey(folderId, key))[0] || null;
    if (f) { if (f.name !== p.name) await Files.rename(f.id, { name: p.name }); return f.id; }
    var app = { cestisAssess: 'photo' }; app[KEY_MARK] = key;
    var made = await Files.copy(p.fileId, { name: p.name, parents: [folderId], appProperties: app });
    var again = await findByKey(folderId, key);
    return again.length ? again[0].id : made.id;
  }
  /* Her own folder of the trainee gate (what this PC knows is published),
     or '' — then no copy is put there. */
  function traineeFolderOf(studentId) {
    try {
      var G = W.CESTISCore.gate;
      if (typeof W.gatePublishedState !== 'function' || typeof W.gateDevRead !== 'function') return '';
      var st = W.gatePublishedState(W.gateDevRead('cestisGatePublished', null));
      var acct = list(W.userAccounts).filter(function (a) { if (!G.eligible(a)) return false; var s = G.studentFor(a, list(W.students)); return !!s && str(s.id) === str(studentId); })[0];
      var f = acct && st.folders[str(acct.id)];
      return f && f.id ? str(f.id) : '';
    } catch (e) { return ''; }
  }

  /* The photos of a paper, for drawing it (two to a page). */
  var photoCache = {};
  function imageSize(blob) {
    return new Promise(function (res) {
      var u = URL.createObjectURL(blob), im = new Image();
      im.onload = function () { res({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(u); };
      im.onerror = function () { res({ w: 0, h: 0 }); URL.revokeObjectURL(u); };
      im.src = u;
    });
  }
  async function photoBytes(p) {
    if (photoCache[p.fileId]) return photoCache[p.fileId];
    var buf = await Files.bytes(p.fileId), type = p.type || 'image/jpeg', w = p.w, h = p.h;
    if (!(w > 0 && h > 0)) { var sz = await imageSize(new Blob([buf], { type: type })); w = sz.w; h = sz.h; }
    var keys = Object.keys(photoCache);
    if (keys.length > 60) delete photoCache[keys[0]];
    photoCache[p.fileId] = { buf: buf, type: type, w: w, h: h };
    return photoCache[p.fileId];
  }
  async function photosFor(item, maxBytes) {
    var out = {}, total = 0;
    if (!item || !item.photos || !canReach()) return { photos: out, cut: false, missing: item && item.photos ? item.photos.length : 0 };
    for (var i = 0; i < item.photos.length; i++) {
      var p = item.photos[i];
      if (!p.fileId) continue;
      try {
        var b = await photoBytes(p);
        total += b.buf.byteLength;
        if (maxBytes && total > maxBytes) return { photos: {}, cut: true };
        out[p.id] = { data: 'data:' + (/png/i.test(b.type) ? 'image/png' : 'image/jpeg') + ';base64,' + W.CESTISAssessPdf.toBase64(b.buf), w: b.w, h: b.h };
      } catch (e) { if (e && e.storageFull) throw e; /* drawn as "could not be read on this computer" */ }
    }
    return { photos: out, cut: false };
  }

  function itemsNow(only) {
    return A.paperItems({ exams: S.exams(), results: list(W.examResults), work: S.work(), students: list(W.students),
      centreName: S.centreName(), offset: S.offset(), now: Date.now(), only: only });
  }
  /* One paper filed: the office copy, the photos, her own copy. */
  async function fileOne(due) {
    var it = due, prev = due.filed || {}, parts = Object.assign({}, prev.parts || {}), at = S.nowIso(), by = me().name;
    var folderId = await folderFor(it.path);
    var tf = Object.assign({}, prev.traineeFiles || {}), recs = [], fileId = prev.fileId || '';
    var same = function (part, h, id) { return id && parts[part] === h; };
    if (it.kind === 'theory') {
      var h1 = A.modelHash(it.model);
      if (!same('office', h1, fileId) || !(await liveId(fileId))) { fileId = await putFile(folderId, it.key, 'paper', it.name, await S.renderPdf(it.model), 'application/pdf', fileId); parts.office = h1; }
      var hers = traineeFolderOf(it.studentId), h2 = A.modelHash(it.mine);
      if (hers && !same('mine', h2, tf[it.studentId])) {
        try { tf[it.studentId] = await putFile(hers, it.key + '|mine', 'trainee', it.name, await S.renderPdf(it.mine), 'application/pdf', tf[it.studentId]); parts.mine = h2; }
        catch (e) { if (e && e.storageFull) throw e; console.warn('[Assessments] her own copy was not put in her folder this time:', e && e.message); }
      }
      recs.push(A.filedRecord({ key: it.key, examId: it.examId, studentId: it.studentId, status: it.status, fileId: fileId, folderId: folderId, name: it.name, path: it.path,
        docNo: it.model.docNo, hash: it.hash, traineeFiles: tf, parts: parts, at: at, by: by }));
    } else {
      var pf = Object.assign({}, prev.photoFiles || {});
      for (var i = 0; i < it.photos.length; i++) {
        var p = it.photos[i];
        if (!p.fileId) continue;
        try { pf[p.id] = await putPhoto(folderId, p, pf[p.id]); }
        catch (e) { if (e && e.storageFull) throw e; console.warn('[Assessments] a photo was not copied this time:', e && e.message); }
      }
      var hg = A.modelHash(it.model) + '|' + it.photos.map(function (x) { return x.id; }).join(',');
      if (!same('office', hg, fileId) || !(await liveId(fileId))) {
        var ph = await photosFor(it, 0);
        fileId = await putFile(folderId, it.key, 'group', it.name, await S.renderPdf(it.model, { photos: ph.photos }), 'application/pdf', fileId);
        parts.office = hg;
      }
      var small = null;
      for (var j = 0; j < it.members.length; j++) {
        var m = it.members[j], herF = traineeFolderOf(m.studentId), hm = A.modelHash(m.model) + '|' + it.photos.map(function (x) { return x.id; }).join(',');
        if (!herF) continue;
        if (!same('m:' + m.studentId, hm, tf[m.studentId])) {
          try {
            if (!small) small = await photosFor(it, MEMBER_PHOTOS_MAX);
            var mm = small.cut ? Object.assign({}, m.model, { photos: [] }) : m.model;
            tf[m.studentId] = await putFile(herF, it.key + '|' + m.studentId, 'trainee', m.name, await S.renderPdf(mm, { photos: small.photos }), 'application/pdf', tf[m.studentId]);
            parts['m:' + m.studentId] = hm;
          } catch (e) { if (e && e.storageFull) throw e; console.warn('[Assessments] a member\'s own copy was not put in her folder this time:', e && e.message); continue; }
        }
        recs.push(A.filedRecord({ key: 'mem:' + it.groupId + ':' + m.studentId, examId: it.examId, studentId: m.studentId, groupId: it.groupId,
          status: m.model.provisional ? 'provisional' : 'final', name: m.name, docNo: m.model.docNo, traineeFiles: (function () { var o = {}; o[m.studentId] = tf[m.studentId]; return o; })(), at: at, by: by }));
      }
      recs.unshift(A.filedRecord({ key: it.key, examId: it.examId, groupId: it.groupId, status: it.status, fileId: fileId, folderId: folderId, name: it.name, path: it.path,
        docNo: it.model.docNo, hash: it.hash, traineeFiles: tf, photoFiles: pf, parts: parts, at: at, by: by }));
    }
    // Only ever more: a filed record replaces its older self (newest wins).
    S.saveWork(recs);
    return recs[0];
  }
  var filing = { busy: false, at: 0, writes: -2, left: 0, failedAt: {}, last: null };
  function mayFile() { var r = S.role(); return (r === 'admin' || r === 'adminstaff') && canReach(); }
  async function fileDue(o) {
    o = o || {};
    if (filing.busy || !mayFile()) return { ran: false };
    filing.busy = true;
    var done = 0, failed = 0, left = 0;
    try {
      var due = A.filingDue(itemsNow(o.only), S.work()).filter(function (d) { return o.only || Date.now() - (filing.failedAt[d.key] || 0) > 10 * 60000; });
      left = due.length;
      if (!due.length) return { ran: true, done: 0, left: 0 };
      await S.pdfKit();
      for (var i = 0; i < due.length && done < (o.max || 4); i++) {
        try { await fileOne(due[i]); done++; left--; delete filing.failedAt[due[i].key]; }
        catch (e) {
          failed++;
          filing.failedAt[due[i].key] = Date.now();
          console.warn('[Assessments] a record was not filed this time (tried again later):', e && (e.message || e));
          if (!e || !e.status || e.storageFull || e.status === 401 || e.status === 403 || e.status === 429 || e.status >= 500) break;
        }
      }
      if (done) { try { S.refresh('filed'); } catch (e) {} }
      return { ran: true, done: done, failed: failed, left: left };
    } finally {
      filing.busy = false; filing.at = Date.now(); filing.left = left;
      filing.writes = W.CESTISStore && typeof W.CESTISStore.writes === 'number' ? W.CESTISStore.writes : -1;
      filing.last = { at: new Date().toISOString(), done: done, failed: failed, left: left };
    }
  }
  /* Beside the save (index.html's assessFilingTick): papers still to file,
     every minute; otherwise when the records changed (at most every 20
     seconds), or every 10 minutes. Never waited for. */
  function fileTick() {
    if (filing.busy || !mayFile()) return;
    var since = Date.now() - filing.at;
    var w = W.CESTISStore && typeof W.CESTISStore.writes === 'number' ? W.CESTISStore.writes : -1;
    if (!(since >= 10 * 60000 || (filing.left && since >= 60000) || (w !== filing.writes && since >= 20000))) return;
    fileDue().catch(function (e) { console.warn('[Assessments] filing:', e && e.message); });
  }

  /* ==================================================================
     MARKING A PRACTICAL — a result for each member, with the checklist
     and a comment (the owner's decision 4).
     ================================================================== */
  function mayMark(e) {
    var m = me(), a = (e && e.assessment) || {};
    if (!e) return false;
    return A.mayCheck(m.role, m.role === 'instructor' ? courseMatch(a.programme, m.course) || courseMatch(e.course, m.course) : true);
  }
  var thumbUrls = {};
  function thumbHtml(p) {
    return '<button type="button" class="assess-shot" data-photo="' + esc(p.id) + '" style="text-align:left;cursor:pointer;padding:0"><div class="assess-shot-img" data-thumb="' + esc(p.fileId) + '">' +
      (thumbUrls[p.fileId] ? '<img alt="' + esc(p.caption) + '" src="' + thumbUrls[p.fileId] + '">' : 'Photo') + '</div>' +
      '<div class="assess-shot-cap">' + esc(p.caption || 'Photo') + '<small>' + esc(p.by || '') + (p.at ? ' · ' + esc(p.at) : '') + '</small></div></button>';
  }
  function fillThumbs(box, photos) {
    if (!canReach()) return;
    photos.forEach(function (p) {
      if (!p.fileId || thumbUrls[p.fileId]) return;
      photoBytes(p).then(function (b) {
        thumbUrls[p.fileId] = URL.createObjectURL(new Blob([b.buf], { type: b.type }));
        box.querySelectorAll('[data-thumb="' + p.fileId + '"]').forEach(function (el) { el.innerHTML = '<img alt="" src="' + thumbUrls[p.fileId] + '">'; });
      }, function () {});
    });
  }
  function photoList(item, model) {
    var byId = {};
    list(model && model.photos).forEach(function (p) { byId[p.id] = p; });
    return list(item && item.photos).map(function (p) { var m = byId[p.id] || {}; return Object.assign({}, p, { by: m.by || '', at: m.at || '' }); });
  }
  function markPractical(examId, groupId) {
    var e0 = S.examById(examId);
    if (!e0 || !A.isPractical(e0)) return;
    if (!mayMark(e0)) { S.toast('Only the Administrator and the programme\'s instructors record practical results.', 'warning'); return; }
    var copies = A.isMaster(e0) ? A.copiesOf(S.exams(), e0.id) : [e0];
    if (!copies.length) { S.toast('Open it for an intake first.', 'warning'); return; }
    var state = { ex: copies[0], gid: groupId || '' };
    if (groupId) copies.forEach(function (c) { if (A.groupsOf(S.work(), c.id).some(function (g) { return g.id === groupId; })) state.ex = c; });
    var d = S.dialog({ title: 'Mark — ' + A.KINDS[state.ex.assessment.kind].label, wide: true, body: '<div class="assess-err" hidden></div><div data-m="pick"></div><div data-m="body"></div>',
      actions: [{ id: 'cancel', label: 'Close', close: true }, { id: 'save', label: 'Save results', kind: 'primary' }],
      onAction: function (act, dl) { if (act === 'save') save(dl); } });
    d.el.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.getAttribute('data-m') === 'copy') { state.ex = copies[Number(t.value)]; state.gid = ''; draw(); }
      if (t.getAttribute('data-m') === 'group') { state.gid = t.value; draw(); }
    });
    d.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-photo]');
      if (b) { var it = itemFor(); var p = it && it.photos.filter(function (x) { return x.id === b.getAttribute('data-photo'); })[0]; if (p) viewPhoto(p, it); }
    });
    function groupsNow() { return A.groupsOf(S.work(), state.ex.id).filter(function (g) { return !g.withdrawn; }); }
    function itemFor() { return state.gid ? itemsNow('grp:' + state.gid)[0] || null : null; }
    function draw() {
      var gs = groupsNow();
      if (!state.gid || !gs.some(function (g) { return g.id === state.gid; })) {
        var firstIn = gs.filter(function (g) { var st = A.groupState(g, S.work()); return st && st.handedIn && st.members.some(function (m) { return !A.memberResult(S.work(), state.ex.id, m); }); })[0];
        state.gid = (firstIn || gs[0] || {}).id || '';
      }
      d.q('[data-m="pick"]').innerHTML = '<div class="assess-row2">' + (copies.length > 1 ? '<label class="assess-field">Intake<select class="form-control" data-m="copy">' + copies.map(function (c, i) { return '<option value="' + i + '"' + (c === state.ex ? ' selected' : '') + '>' + esc(c.assessment.intake || c.course) + '</option>'; }).join('') + '</select></label>' : '') +
        '<label class="assess-field">Group<select class="form-control" data-m="group">' + gs.map(function (g) { var st = A.groupState(g, S.work()); return '<option value="' + esc(g.id) + '"' + (g.id === state.gid ? ' selected' : '') + '>' + esc(g.name) + (st && st.handedIn ? ' — handed in' : ' — not handed in yet') + '</option>'; }).join('') + '</select></label></div>';
      var body = d.q('[data-m="body"]');
      var g = gs.filter(function (x) { return x.id === state.gid; })[0];
      if (!g) { body.innerHTML = '<p class="assess-empty">There are no groups for this intake yet. Use Groups… on the Assessments page.</p>'; return; }
      var st = A.groupState(g, S.work()), p = state.ex.practical || {}, nm = S.names(), checklist = list(p.checklist);
      var it = st.handedIn ? itemFor() : null, model = it ? it.model : null;
      var photos = it ? photoList(it, model) : st.photos.map(function (x) { var f = list(x.driveFiles)[0] || {}; return { id: x.id, fileId: str(f.driveFileId || f.id), type: f.type, caption: x.caption, by: nm[x.studentId] || '', at: A.when(x.addedAt, S.offset()) }; });
      var head = '<p class="assess-sub" style="margin-bottom:10px"><strong>' + esc(p.title || state.ex.title) + '</strong> · ' + esc(state.ex.assessment.intake || state.ex.course) + '<br>' +
        (st.handedIn ? 'Handed in ' + esc(A.when(st.handedIn.at, S.offset())) + ' by ' + esc(nm[st.handedIn.by] || 'a member') : 'Not handed in yet — you can still record results.') +
        ' · ' + st.photos.length + ' photo' + (st.photos.length === 1 ? '' : 's') + ' · signed by ' + Object.keys(st.signed).length + ' of ' + st.members.length + '</p>';
      var shots = photos.length ? '<div class="assess-shots">' + photos.map(thumbHtml).join('') + '</div>' + (canReach() ? '' : '<p class="assess-sub">The photos can be seen when this computer is online.</p>') : '<p class="assess-empty">No photos yet.</p>';
      var res = {}; st.members.forEach(function (sid) { res[sid] = A.memberResult(S.work(), state.ex.id, sid); });
      var grid = '<div class="table-wrapper"><table class="assess-check-grid"><thead><tr><th>What the assessor checks</th>' + st.members.map(function (sid) { return '<th title="' + esc(nm[sid] || sid) + '">' + esc(A.memberShort(nm[sid] || sid)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        checklist.map(function (c, ci) {
          return '<tr><td>' + esc(c) + '</td>' + st.members.map(function (sid) {
            var r = res[sid], hit = r ? list(r.checklist).filter(function (x) { return A.normTitle(x.text) === A.normTitle(c); })[0] : null;
            return '<td><input type="checkbox" data-c="' + ci + '" data-s="' + esc(sid) + '"' + (hit && hit.met ? ' checked' : '') + ' aria-label="' + esc((nm[sid] || sid) + ': ' + c) + '"></td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
      var per = st.members.map(function (sid) {
        var r = res[sid];
        return '<div class="assess-kind" style="margin-top:10px"><div class="assess-kind-top"><span class="assess-kind-name">' + esc(nm[sid] || sid) + ' <span class="assess-sid">' + esc(sid) + '</span></span>' +
          (r ? '<span class="assess-chip ' + (r.outcome === 'competent' ? 'is-ready' : 'is-fail') + '">' + esc(A.OUTCOMES[r.outcome]) + '</span>' : '<span class="assess-chip is-check">Awaiting marking</span>') + '</div>' +
          '<div class="assess-row2"><label class="assess-field">Result<select class="form-control" data-o="' + esc(sid) + '"><option value="">Choose…</option><option value="competent"' + (r && r.outcome === 'competent' ? ' selected' : '') + '>Competent</option><option value="nyc"' + (r && r.outcome === 'nyc' ? ' selected' : '') + '>Not yet competent</option></select></label>' +
          '<label class="assess-field">Comment<textarea class="form-control" rows="2" maxlength="1000" data-k="' + esc(sid) + '" placeholder="What she did well, or what to work on">' + esc(r ? r.comment : '') + '</textarea></label></div>' +
          (r ? '<div class="assess-kind-meta">Recorded by ' + esc(r.assessorName || 'staff') + ', ' + esc(A.when(r.markedAt, S.offset())) + '</div>' : '') + '</div>';
      }).join('');
      body.innerHTML = head + '<h4 style="margin:8px 0 4px">The group\'s photos</h4>' + shots + '<h4 style="margin:12px 0 4px">For each member</h4>' + grid + per;
      fillThumbs(body, photos);
    }
    function save(dl) {
      var g = groupsNow().filter(function (x) { return x.id === state.gid; })[0];
      if (!g) return;
      var st = A.groupState(g, S.work()), checklist = list((state.ex.practical || {}).checklist), m = me(), at = S.nowIso(), recs = [];
      for (var i = 0; i < st.members.length; i++) {
        var sid = st.members[i], out = dl.q('[data-o="' + sid + '"]').value;
        if (!out) continue;
        var r = A.practicalResult({ examId: state.ex.id, groupId: g.id, studentId: sid, outcome: out, comment: dl.q('[data-k="' + sid + '"]').value,
          checklist: checklist.map(function (c, ci) { var box = dl.q('[data-c="' + ci + '"][data-s="' + sid + '"]'); return { text: c, met: !!(box && box.checked) }; }),
          by: { id: m.id, name: m.name, role: m.role }, at: at });
        if (r.error) return dl.error(r.error === 'comment' ? 'A comment: plain words, at most 1000 characters (no < or >).' : 'Choose Competent or Not yet competent.');
        var old = A.memberResult(S.work(), state.ex.id, sid);
        if (old && old.outcome === r.rec.outcome && old.comment === r.rec.comment && JSON.stringify(old.checklist) === JSON.stringify(r.rec.checklist)) continue;
        recs.push(r.rec);
      }
      if (!recs.length) { dl.error('Choose a result for at least one member (or change one).'); return; }
      dl.error('');
      S.saveWork(recs);
      S.toast('Saved the result for ' + recs.length + ' member' + (recs.length === 1 ? '' : 's') + '. The group\'s record is filed again with it.');
      draw();
      rerenderAll();
    }
    draw();
    return d;
  }

  /* ==================================================================
     THE ASSESSMENT RESULTS PAGE (the owner's decision 9) — the
     Administrator, and Admin Staff with the "Assessment Results" tick.
     ================================================================== */
  var rview = { prog: '', intake: '', unit: '', kind: '', status: '', sel: {} };
  function filedByKey() {
    var by = {};
    S.work().forEach(function (f) { if (f && f.type === 'filed' && (!by[f.key] || (Date.parse(f.updatedAt || '') || 0) > (Date.parse(by[f.key].updatedAt || '') || 0))) by[f.key] = f; });
    return by;
  }
  function allRows(filters) {
    return A.resultRows({ exams: S.exams(), results: list(W.examResults), work: S.work(), students: list(W.students), filters: filters || null });
  }
  function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function renderResults(root) {
    S.styles();
    var every = allRows(null);
    var rows = allRows({ programme: rview.prog, intake: rview.intake, unit: rview.unit, kind: rview.kind, status: rview.status });
    var c = A.resultCounts(rows), filed = filedByKey(), off = S.offset();
    var uniq = function (f) { var s = {}; every.forEach(function (r) { var v = f(r); if (v && v[0]) s[v[0]] = v[1]; }); return Object.keys(s).sort().map(function (k) { return [k, s[k]]; }); };
    var progs = uniq(function (r) { return [r.programme, r.programme]; }), intakes = uniq(function (r) { return [r.intake, r.intake]; }),
      units = uniq(function (r) { var t = str(r.unitTitle); return [r.unitCode || r.unitTitle, (r.unitCode ? r.unitCode + ' — ' : '') + (t.length > 48 ? t.slice(0, 46).replace(/\s+\S*$/, '') + '…' : t)]; });
    var keys = {}; rows.forEach(function (r) { keys[r.key] = 1; });
    Object.keys(rview.sel).forEach(function (k) { if (!keys[k]) delete rview.sel[k]; });
    var nSel = Object.keys(rview.sel).length;
    var tools = '<div class="assess-tools assess-filters">' +
      '<label>Programme<select class="form-control" data-rf="prog"><option value="">All</option>' + progs.map(function (p) { return opt(p[0], p[1], rview.prog); }).join('') + '</select></label>' +
      '<label>Intake<select class="form-control" data-rf="intake"><option value="">All</option>' + intakes.map(function (p) { return opt(p[0], p[1], rview.intake); }).join('') + '</select></label>' +
      '<label>Unit<select class="form-control" data-rf="unit"><option value="">All</option>' + units.map(function (p) { return opt(p[0], p[1], rview.unit); }).join('') + '</select></label>' +
      '<label>Assessment<select class="form-control" data-rf="kind"><option value="">All</option>' + A.ORDER.map(function (k) { return opt(k, A.KINDS[k].label, rview.kind); }).join('') + '</select></label>' +
      '<label>Result<select class="form-control" data-rf="status"><option value="">All</option>' + opt('final', 'Marked', rview.status) + opt('provisional', 'Awaiting marking', rview.status) + '</select></label></div>';
    var table = rows.map(function (r) {
      var f = filed[r.key];
      var who = r.kind === 'theory' ? esc(r.name) + ' <span class="assess-sid">' + esc(r.studentId) + '</span>' : '<strong>' + esc(r.groupName) + '</strong><br><span class="assess-sid">' + esc(r.members.join(', ')) + '</span>';
      var result = r.kind === 'theory'
        ? (r.status === 'provisional' ? esc(r.score) + '% so far · ' + esc(r.pending) + ' awaiting marking' : esc(r.score) + '% (' + esc(r.earned) + ' / ' + esc(r.total) + ') · ' + (r.passed ? 'Competent' : 'Not yet competent'))
        : esc(r.marked) + ' of ' + esc(r.memberIds.length) + ' marked · ' + esc(r.photos) + ' photo' + (r.photos === 1 ? '' : 's');
      var chipH = r.status === 'provisional' ? '<span class="assess-chip is-check">Provisional</span>' : '<span class="assess-chip is-ready">Marked</span>';
      var filedH = f && f.fileId ? '<div class="assess-sid">' + (f.status === r.status ? 'Filed' : 'Filed (provisional) — the marked copy follows') + '</div>' : '<div class="assess-sid">Not filed yet</div>';
      var acts = '<button type="button" class="btn btn-secondary" data-ra="view" data-k="' + esc(r.key) + '">View PDF</button>' +
        '<button type="button" class="btn btn-secondary" data-ra="download" data-k="' + esc(r.key) + '">Download</button>' +
        (r.kind === 'practical' ? '<button type="button" class="btn btn-secondary" data-ra="photos" data-k="' + esc(r.key) + '">Photos</button>' : '') +
        (r.kind === 'practical' && mayMark(S.examById(r.examId)) ? '<button type="button" class="btn btn-primary" data-ra="mark" data-k="' + esc(r.key) + '">Mark</button>' : '');
      return '<tr><td><input type="checkbox" data-rs="' + esc(r.key) + '"' + (rview.sel[r.key] ? ' checked' : '') + ' aria-label="Select"></td><td>' + who + '</td><td>' + esc(A.unitLabel({ code: r.unitCode, title: '' }) || r.unitTitle) + '<br><span class="assess-sid">' + esc(r.intake) + '</span></td>' +
        '<td>' + esc(A.KINDS[r.assessment] ? A.KINDS[r.assessment].label : '') + '</td><td>' + esc(A.when(r.finished, off)) + '</td><td>' + result + '</td><td>' + chipH + filedH + '</td><td><div class="assess-row-acts">' + acts + '</div></td></tr>';
    }).join('');
    root.innerHTML = '<div class="assess-head"><div><h2>Assessment Results</h2><p class="assess-sub">Every completed assessment, newest first. Each record is also filed in the Assessment Results folder, by programme, intake and unit.</p></div></div>' +
      '<div class="card">' + tools +
      '<div class="assess-counts" style="margin-top:12px"><span class="assess-chip">' + c.completed + ' completed</span><span class="assess-chip is-check">' + c.awaiting + ' awaiting marking</span><span class="assess-chip is-ready">' + c.final + ' marked</span>' +
        (c.groups ? '<span class="assess-chip is-open">' + c.groups + ' group practical' + (c.groups === 1 ? '' : 's') + ' · ' + c.photos + ' photos</span>' : '') + '</div>' +
      '<div class="assess-acts" style="margin-bottom:10px"><button type="button" class="btn btn-secondary" data-ra="all">' + (nSel && nSel === rows.length ? 'Clear the selection' : 'Select all') + '</button>' +
        '<button type="button" class="btn btn-primary" data-ra="combine"' + (nSel ? '' : ' disabled') + '>Download selected as one PDF' + (nSel ? ' (' + nSel + ')' : '') + '</button></div>' +
      (rows.length ? '<div class="table-wrapper"><table class="assess-table"><thead><tr><th></th><th>Trainee or group</th><th>Unit</th><th>Assessment</th><th>Finished</th><th>Result</th><th>Status</th><th></th></tr></thead><tbody>' + table + '</tbody></table></div>'
        : '<p class="assess-empty">' + (every.length ? 'No completed assessments match.' : 'No assessments have been completed yet.') + '</p>') +
      '<p class="assess-sub" style="margin-top:10px">A paper still awaiting marking prints as Provisional. When it is marked, the marked copy replaces it in the folder; the earlier copy is kept with it.</p></div>';
  }
  function rowByKey(key) { return allRows(null).filter(function (r) { return r.key === key; })[0] || null; }
  async function paperBytes(key) {
    var it = itemsNow(key)[0];
    if (!it) throw new Error('not-found');
    await S.pdfKit();
    var extra = it.kind === 'practical' ? { photos: (await photosFor(it, 0)).photos } : {};
    return { item: it, bytes: await S.renderPdf(it.model, extra) };
  }
  function busy(btn, on) { if (!btn) return; if (on) { btn._label = btn.textContent; btn.disabled = true; btn.textContent = 'Making…'; } else { btn.disabled = false; if (btn._label) btn.textContent = btn._label; } }
  function resultsAction(act, key, btn) {
    if (act === 'view' || act === 'download') {
      busy(btn, true);
      return paperBytes(key).then(function (p) { if (act === 'view') S.view(p.bytes, p.item.name); else S.download(p.bytes, p.item.name); },
        function () { S.toast('That record could not be made just now. Try again.', 'error'); }).then(function () { busy(btn, false); });
    }
    if (act === 'photos') return photosDialog(key);
    if (act === 'mark') { var r = rowByKey(key); if (r) markPractical(r.examId, r.groupId); return; }
    if (act === 'combine') return combineSelected(btn);
  }
  async function combineSelected(btn) {
    var keys = allRows({ programme: rview.prog, intake: rview.intake, unit: rview.unit, kind: rview.kind, status: rview.status }).map(function (r) { return r.key; }).filter(function (k) { return rview.sel[k]; });
    if (!keys.length) return;
    busy(btn, true);
    try {
      var all = [];
      for (var i = 0; i < keys.length; i++) all.push((await paperBytes(keys[i])).bytes);
      await W.cestisNeedLib('PDFLib');
      var out = await W.CESTISAssessPdf.combine(all, W.PDFLib);
      var day = X.centreParts(Date.now(), S.offset()).date;
      S.download(out, 'Assessment records ' + day + ' (' + keys.length + ').pdf');
      S.toast('Saved ' + keys.length + ' record' + (keys.length === 1 ? '' : 's') + ' as one PDF, ready to print.');
    } catch (e) { S.toast('The records could not be put together just now. Try again.', 'error'); }
    busy(btn, false);
  }
  function viewPhoto(p, item) {
    var d = S.dialog({ title: p.caption || 'Photo', wide: true, body: '<div class="assess-photo-view"><p class="assess-sub">Opening…</p></div>',
      actions: [{ id: 'dl', label: 'Download this photo' }, { id: 'close2', label: 'Close', close: true }],
      onAction: function (act) {
        if (act !== 'dl') return;
        photoBytes(p).then(function (b) { S.download(new Blob([b.buf], { type: b.type }), p.name, b.type); }, function () { S.toast('This photo cannot be opened just now.', 'error'); });
      } });
    if (!canReach()) { d.q('.assess-photo-view').innerHTML = '<p class="assess-sub">The photos can be seen when this computer is online.</p>'; return d; }
    photoBytes(p).then(function (b) {
      var u = URL.createObjectURL(new Blob([b.buf], { type: b.type }));
      d.q('.assess-photo-view').innerHTML = '<img alt="' + esc(p.caption) + '" src="' + u + '"><p class="assess-sub">' + esc(p.name) + (b.w ? ' · ' + b.w + ' × ' + b.h : '') + (p.by ? ' · added by ' + esc(p.by) : '') + (p.at ? ', ' + esc(p.at) : '') + (item ? ' · ' + esc(item.groupName) : '') + '</p>';
    }, function () { d.q('.assess-photo-view').innerHTML = '<p class="assess-sub">This photo cannot be opened just now.</p>'; });
    return d;
  }
  function photosDialog(key) {
    var it = itemsNow(key)[0];
    if (!it || it.kind !== 'practical') return;
    var photos = photoList(it, it.model);
    var d = S.dialog({ title: 'Photos — ' + it.groupName + ' · ' + A.KINDS[it.assessment].label, wide: true,
      body: '<p class="assess-sub" style="margin-bottom:8px">' + esc(it.model.heading) + '. Full size, as the group took them. Press a photo to see it alone and download it.</p>' +
        (photos.length ? '<div class="assess-shots" data-g="photos">' + photos.map(thumbHtml).join('') + '</div>' : '<p class="assess-empty">No photos.</p>') +
        (canReach() ? '' : '<p class="assess-sub">The photos can be seen when this computer is online.</p>'),
      actions: [{ id: 'zip', label: 'Download all (' + photos.length + ') as a ZIP', kind: 'primary', disabled: !photos.length || !canReach() }, { id: 'close2', label: 'Close', close: true }],
      onAction: function (act, dl, ev) { if (act === 'zip') zipPhotos(it, ev && ev.target && ev.target.closest('button')); } });
    d.el.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-photo]');
      if (!b) return;
      var p = photos.filter(function (x) { return x.id === b.getAttribute('data-photo'); })[0];
      if (p) viewPhoto(p, it);
    });
    fillThumbs(d.el, photos);
    return d;
  }
  async function zipPhotos(it, btn) {
    busy(btn, true);
    try {
      await W.cestisNeedLib('JSZip');
      var zip = new W.JSZip(), n = 0;
      for (var i = 0; i < it.photos.length; i++) {
        var p = it.photos[i];
        if (!p.fileId) continue;
        try { zip.file(p.name, (await photoBytes(p)).buf); n++; } catch (e) { /* one not read: the rest still go */ }
      }
      if (!n) throw new Error('none');
      var blob = await zip.generateAsync({ type: 'blob' });
      S.download(blob, it.zip, 'application/zip');
      S.toast('Saved ' + n + ' photo' + (n === 1 ? '' : 's') + ' as ' + it.zip.replace(/[–—]/g, '-') + '.');
    } catch (e) { S.toast('The photos could not be put together just now. Try again.', 'error'); }
    busy(btn, false);
  }
  function bindResults(root) {
    if (root._resultsBound) return;
    root._resultsBound = true;
    root.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-ra]');
      if (!b || !root.contains(b)) return;
      var act = b.getAttribute('data-ra');
      if (act === 'all') {
        var rows = allRows({ programme: rview.prog, intake: rview.intake, unit: rview.unit, kind: rview.kind, status: rview.status });
        var allOn = rows.length && rows.every(function (r) { return rview.sel[r.key]; });
        rview.sel = {};
        if (!allOn) rows.forEach(function (r) { rview.sel[r.key] = 1; });
        renderResults(root);
        return;
      }
      resultsAction(act, b.getAttribute('data-k'), b);
    });
    root.addEventListener('change', function (ev) {
      var t = ev.target, f = t.getAttribute('data-rf'), s = t.getAttribute('data-rs');
      if (f) { rview[f] = t.value; renderResults(root); }
      if (s) { if (t.checked) rview.sel[s] = 1; else delete rview.sel[s]; renderResults(root); }
    });
  }
  function rerenderAll() {
    var r1 = S.rootFor('assessment-results'); if (r1 && r1.closest('.page.active')) renderResults(r1);
    rerender();
  }
  function mountResults(root) {
    bindResults(root);
    S.register('assessment-results', function (r) { renderResults(r); });
    renderResults(root);
  }

  var Staff = { mount: null, renderAssessments: renderAssessments, prepare: prepare, preview: preview, edit: edit, markReady: markReady, openForIntake: openForIntake, groups: groups,
    me: me, courseMatch: courseMatch, catalogs: catalogs, loadIndex: loadIndex, loadBank: loadBank, rosterFor: rosterFor, asTicks: asTicks, updateBadge: updateBadge,
    mayAddTime: mayAddTime, addTime: addTime,
    // the office copy, marking a practical, the Assessment Results page
    fileDue: fileDue, fileTick: fileTick, filingState: function () { return JSON.parse(JSON.stringify({ busy: filing.busy, last: filing.last, left: filing.left })); },
    rootFolder: rootFolder, markPractical: markPractical, renderResults: renderResults, photosDialog: photosDialog, paperBytes: paperBytes,
    mountResults: mountResults };

  Staff.mount = function (feature, prefix) {
    S.styles();
    var root = S.rootFor(feature);
    if (!root) return;
    if (feature === 'assessments') {
      bindAssessments(root);
      S.register('assessments', function (r) { renderAssessments(r); });
      renderAssessments(root);
      return loadIndex().then(function () { renderAssessments(S.rootFor('assessments') || root); });
    }
    if (feature === 'assessment-results' && typeof Staff.mountResults === 'function') return Staff.mountResults(root, prefix);
  };

  W.CESTISAssessStaff = Staff;
})();
