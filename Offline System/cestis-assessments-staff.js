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
     Assessment Results      (stage 5, below)
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
          byRole: m.role, byName: m.name, at: S.nowIso(), offset: off });
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

  var Staff = { mount: null, renderAssessments: renderAssessments, prepare: prepare, preview: preview, edit: edit, markReady: markReady, openForIntake: openForIntake, groups: groups,
    me: me, courseMatch: courseMatch, catalogs: catalogs, loadIndex: loadIndex, loadBank: loadBank, rosterFor: rosterFor, asTicks: asTicks, updateBadge: updateBadge };

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
