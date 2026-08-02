/* ============================================================================
   cmc-portal.js — CMC Board (Community Management Committee) view-only portal.

   The CMC oversees the Centre but does not operate it, so every panel here is
   STRICTLY READ-ONLY: the portal renders from the shared data core and exposes
   no control that creates, edits or deletes anything.

   Panels (mounted from Pages/CMC-Portal.html):
     Dashboard        — total students on the platform + headline counts
     Student Progress — enrolment/progress roster, read-only
     Announcements    — published notices
     Calendar         — scheduled events
     LMS Chat         — read the conversation; no compose box
     Video Conference — scheduled sessions/meetings; no host/join controls
     Cashbook         — CESTIS.Cashbook.html?view=cmc, which itself restricts
                        the CMC to its Main Dashboard and Transactions pages.

   The summary/derivation helpers are pure and Node-safe so they can be unit
   tested (tests/cmc-portal.test.js).
   ============================================================================ */
(function (root) {
  'use strict';

  /* ==========================================================================
     PURE HELPERS (unit tested)
     ========================================================================== */

  /* The pages the CMC may see. Anything not listed is denied — used by both the
     portal tabs and the Cashbook's cmc view mode. */
  var CMC_ALLOWED_PANELS = ['dashboard', 'students', 'announcements', 'calendar', 'chat', 'video', 'cashbook'];
  var CMC_ALLOWED_CASHBOOK_PAGES = ['dashboard', 'transactions'];

  function cmcPanelAllowed(panel) { return CMC_ALLOWED_PANELS.indexOf(panel) !== -1; }
  function cmcCashbookPageAllowed(page) { return CMC_ALLOWED_CASHBOOK_PAGES.indexOf(page) !== -1; }

  /* Headline platform numbers. "Total students on the platform" is the whole
     student roster, counted once per student record. */
  function cmcStudentSummary(students) {
    var list = Array.isArray(students) ? students : [];
    var byStage = {}, byCourse = {};
    list.forEach(function (s) {
      var stage = (s && s.stage) || 'unknown';
      byStage[stage] = (byStage[stage] || 0) + 1;
      var course = (s && s.course) || 'Unassigned';
      byCourse[course] = (byCourse[course] || 0) + 1;
    });
    var certified = (byStage.certified || 0) + (byStage.collected || 0);
    var inTraining = byStage.training || 0;
    var total = list.length;
    return {
      total: total,
      certified: certified,
      inTraining: inTraining,
      incomplete: byStage.incomplete || 0,
      byStage: byStage,
      byCourse: byCourse,
      certificationRate: total ? Math.round(certified / total * 100) : 0
    };
  }

  /* Average attendance / GPA across the roster, ignoring blank values. */
  function cmcAverages(students) {
    var list = Array.isArray(students) ? students : [];
    var attSum = 0, attN = 0, gpaSum = 0, gpaN = 0;
    list.forEach(function (s) {
      var a = parseFloat(s && s.attendance);
      if (!isNaN(a)) { attSum += a; attN++; }
      var g = parseFloat(s && s.gpa);
      if (!isNaN(g)) { gpaSum += g; gpaN++; }
    });
    return {
      attendance: attN ? Math.round(attSum / attN) : 0,
      gpa: gpaN ? Math.round(gpaSum / gpaN * 100) / 100 : 0
    };
  }

  var api = {
    CMC_ALLOWED_PANELS: CMC_ALLOWED_PANELS,
    CMC_ALLOWED_CASHBOOK_PAGES: CMC_ALLOWED_CASHBOOK_PAGES,
    cmcPanelAllowed: cmcPanelAllowed,
    cmcCashbookPageAllowed: cmcCashbookPageAllowed,
    cmcStudentSummary: cmcStudentSummary,
    cmcAverages: cmcAverages
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root || typeof document === 'undefined') return; // Node: pure exports only.

  /* ==========================================================================
     BROWSER SIDE — view-only panels
     ========================================================================== */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function arr(name) {
    try { var v = root[name]; return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }

  var cmcpState = { panel: 'dashboard', room: null };

  root.cmcPortalOnShow = function () {
    var host = document.getElementById('cmcPortalRoot');
    if (!host) return;
    var role = null;
    try { role = root.currentRole; } catch (e) {}
    if (role !== 'cmc') {
      host.innerHTML = '<div class="card" style="padding:40px;text-align:center;color:var(--text-muted);">' +
        '<div style="font-size:40px;margin-bottom:12px;">🔒</div>' +
        '<h3>CMC Board access only</h3><p>This portal is reserved for the Community Management Committee.</p></div>';
      return;
    }
    cmcpRender();
  };

  root.cmcPortalSetPanel = function (panel) {
    if (!cmcPanelAllowed(panel)) return;
    cmcpState.panel = panel;
    cmcpRender();
  };

  function cmcpRender() {
    var host = document.getElementById('cmcPortalRoot');
    if (!host) return;
    var tabs = [
      ['dashboard', '📊 Dashboard'],
      ['students', '👥 Student Progress'],
      ['chat', '💬 LMS Chat'],
      ['video', '📹 Video Conference'],
      ['announcements', '📢 Announcements'],
      ['calendar', '📅 Calendar'],
      ['cashbook', '💼 Cashbook']
    ];
    var html = '';
    html += '<div class="card cmcp-banner">' +
      '<div style="font-size:26px;">🏛️</div>' +
      '<div style="flex:1;min-width:240px;">' +
        '<div style="font-weight:700;">Community Management Committee — Oversight Portal</div>' +
        '<div style="font-size:12px;color:var(--text-muted);">You have <strong>view-only</strong> access. Nothing on this portal can be created, edited or deleted.</div>' +
      '</div>' +
      '<span class="cmcp-readonly-pill">🔒 READ-ONLY</span></div>';

    html += '<div class="cmcp-tabs">' + tabs.map(function (t) {
      return '<div class="cmcp-tab' + (cmcpState.panel === t[0] ? ' active' : '') + '" onclick="cmcPortalSetPanel(\'' + t[0] + '\')">' + t[1] + '</div>';
    }).join('') + '</div>';

    html += '<div id="cmcPortalPanel"></div>';
    host.innerHTML = html;
    cmcpRenderPanel();
  }

  function cmcpRenderPanel() {
    var el = document.getElementById('cmcPortalPanel');
    if (!el) return;
    switch (cmcpState.panel) {
      case 'students': el.innerHTML = cmcpStudentsPanel(); break;
      case 'announcements': el.innerHTML = cmcpAnnouncementsPanel(); break;
      case 'calendar': el.innerHTML = cmcpCalendarPanel(); break;
      case 'chat': el.innerHTML = cmcpChatPanel(); break;
      case 'video': el.innerHTML = cmcpVideoPanel(); break;
      case 'cashbook': cmcpMountCashbook(el); break;
      default: el.innerHTML = cmcpDashboardPanel();
    }
  }

  function statCard(icon, color, value, label, sub) {
    return '<div class="stat-card">' +
      '<div class="stat-icon" style="background:var(--' + color + '-dim);color:var(--' + color + ');">' + icon + '</div>' +
      '<div class="stat-value">' + esc(value) + '</div>' +
      '<div class="stat-label">' + esc(label) + '</div>' +
      (sub ? '<div class="stat-change" style="color:var(--text-muted);">' + esc(sub) + '</div>' : '') +
      '</div>';
  }

  /* ---------------- Dashboard ---------------- */
  function cmcpDashboardPanel() {
    var students = arr('students');
    var sum = cmcStudentSummary(students);
    var avg = cmcAverages(students);
    var accounts = arr('userAccounts');
    var instructors = accounts.filter(function (u) { return u && u.role === 'instructor'; }).length;
    var staff = accounts.filter(function (u) { return u && u.role === 'adminstaff'; }).length;

    var h = '<div class="stats-grid stats-grid-4">' +
      statCard('👥', 'blue', sum.total, 'Total Students on Platform', 'All enrolled records') +
      statCard('🎓', 'green', sum.certified, 'Certified', sum.certificationRate + '% of all students') +
      statCard('📚', 'accent', sum.inTraining, 'Currently in Training', 'Active trainees') +
      statCard('📊', 'purple', avg.attendance + '%', 'Average Attendance', 'Across the roster') +
      '</div>';

    h += '<div class="grid-2col">';
    // Students by programme
    var courses = Object.keys(sum.byCourse).sort(function (a, b) { return sum.byCourse[b] - sum.byCourse[a]; });
    h += '<div class="card"><div class="card-header"><h3>Students by Programme</h3><span class="cmcp-readonly-pill">View only</span></div>';
    if (!courses.length) {
      h += '<p style="color:var(--text-muted);padding:14px;">No students enrolled yet.</p>';
    } else {
      h += '<div style="display:flex;flex-direction:column;gap:10px;">';
      courses.forEach(function (c) {
        var n = sum.byCourse[c];
        var pct = sum.total ? Math.round(n / sum.total * 100) : 0;
        h += '<div><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">' +
          '<span>' + esc(c) + '</span><strong>' + n + '</strong></div>' +
          '<div style="height:8px;border-radius:5px;background:var(--bg-card-hover,rgba(127,127,127,.15));overflow:hidden;">' +
          '<div style="height:100%;width:' + pct + '%;background:var(--teal,#1abc9c);"></div></div></div>';
      });
      h += '</div>';
    }
    h += '</div>';

    // Pipeline / staffing
    h += '<div class="card"><div class="card-header"><h3>Centre at a Glance</h3><span class="cmcp-readonly-pill">View only</span></div>' +
      '<table class="data-table" style="width:100%;"><tbody>' +
      '<tr><td>Total students on the platform</td><td style="text-align:right;"><strong>' + sum.total + '</strong></td></tr>' +
      '<tr><td>Certified (incl. collected)</td><td style="text-align:right;"><strong>' + sum.certified + '</strong></td></tr>' +
      '<tr><td>In training</td><td style="text-align:right;"><strong>' + sum.inTraining + '</strong></td></tr>' +
      '<tr><td>Marked incomplete</td><td style="text-align:right;"><strong>' + sum.incomplete + '</strong></td></tr>' +
      '<tr><td>Instructors</td><td style="text-align:right;"><strong>' + instructors + '</strong></td></tr>' +
      '<tr><td>Administrative staff</td><td style="text-align:right;"><strong>' + staff + '</strong></td></tr>' +
      '<tr><td>Average GPA</td><td style="text-align:right;"><strong>' + avg.gpa + '</strong></td></tr>' +
      '</tbody></table></div>';
    h += '</div>';
    return h;
  }

  /* ---------------- Student Progress ---------------- */
  function cmcpStudentsPanel() {
    var students = arr('students');
    var sum = cmcStudentSummary(students);
    var stageLabel = {
      testing: 'Testing', interview: 'Interview', training: 'In Training',
      certified: 'Certified', collected: 'Cert. Collected', incomplete: 'Incomplete'
    };
    var rows = students.slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    }).map(function (s) {
      var prog = parseInt(s.progress, 10) || 0;
      return '<tr>' +
        '<td>' + esc(s.name) + '</td>' +
        '<td style="font-size:12px;color:var(--text-muted);">' + esc(s.id || '') + '</td>' +
        '<td>' + esc(s.course || '') + '</td>' +
        '<td>' + esc(stageLabel[s.stage] || s.stage || '') + '</td>' +
        '<td style="min-width:120px;"><div style="height:7px;border-radius:5px;background:var(--bg-card-hover,rgba(127,127,127,.15));overflow:hidden;">' +
          '<div style="height:100%;width:' + Math.max(0, Math.min(100, prog)) + '%;background:var(--teal,#1abc9c);"></div></div>' +
          '<span style="font-size:11px;color:var(--text-muted);">' + prog + '%</span></td>' +
        '<td>' + esc(s.attendance != null ? s.attendance + '%' : '—') + '</td>' +
        '<td>' + esc(s.gpa || '—') + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="card"><div class="card-header"><h3>Student Progress — ' + sum.total + ' student' + (sum.total === 1 ? '' : 's') + ' on the platform</h3>' +
      '<span class="cmcp-readonly-pill">🔒 View only</span></div>' +
      '<div style="overflow-x:auto;"><table class="data-table" style="width:100%;">' +
      '<thead><tr><th>Name</th><th>ID</th><th>Programme</th><th>Stage</th><th>Progress</th><th>Attendance</th><th>GPA</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">No students enrolled yet.</td></tr>') +
      '</tbody></table></div></div>';
  }

  /* ---------------- Announcements ---------------- */
  function cmcpAnnouncementsPanel() {
    var list = arr('announcements');
    if (!list.length) {
      return '<div class="card" style="padding:36px;text-align:center;color:var(--text-muted);">No announcements have been published.</div>';
    }
    var h = '<div class="card"><div class="card-header"><h3>Announcements</h3><span class="cmcp-readonly-pill">🔒 View only</span></div>';
    list.forEach(function (a) {
      var urgent = a.priority === 'urgent';
      h += '<div style="padding:12px 0;border-bottom:1px solid var(--border,#333);">' +
        '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">' +
        '<strong>' + esc(a.title) + '</strong>' +
        (urgent ? '<span class="badge badge-red" style="font-size:10px;">URGENT</span>' : '') +
        '<span style="font-size:11px;color:var(--text-muted);margin-left:auto;">' + esc(a.date || '') + (a.author ? ' • ' + esc(a.author) : '') + '</span></div>' +
        '<div style="font-size:13px;color:var(--text-muted);margin-top:4px;white-space:pre-wrap;">' + esc(a.body || '') + '</div></div>';
    });
    return h + '</div>';
  }

  /* ---------------- Calendar ---------------- */
  function cmcpCalendarPanel() {
    var list = arr('calendarEvents').slice().sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    });
    if (!list.length) {
      return '<div class="card" style="padding:36px;text-align:center;color:var(--text-muted);">No events are scheduled.</div>';
    }
    var today = new Date().toISOString().slice(0, 10);
    var rows = list.map(function (e) {
      var past = String(e.date || '') < today;
      return '<tr style="' + (past ? 'opacity:.55;' : '') + '">' +
        '<td>' + esc(e.date || '') + '</td>' +
        '<td>' + esc(e.time || '') + '</td>' +
        '<td>' + esc(e.title || '') + '</td>' +
        '<td>' + esc(e.type || '') + '</td>' +
        '<td style="font-size:12px;color:var(--text-muted);">' + esc((e.forRoles || []).join(', ')) + '</td></tr>';
    }).join('');
    return '<div class="card"><div class="card-header"><h3>Calendar &amp; Schedule</h3><span class="cmcp-readonly-pill">🔒 View only</span></div>' +
      '<div style="overflow-x:auto;"><table class="data-table" style="width:100%;">' +
      '<thead><tr><th>Date</th><th>Time</th><th>Event</th><th>Type</th><th>Audience</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  /* ---------------- LMS Chat (read-only) ---------------- */
  function cmcpChatPanel() {
    var rooms = arr('lmsChatRooms');
    var msgs = {};
    try { msgs = root.lmsChatMessages || {}; } catch (e) { msgs = {}; }
    if (!rooms.length) {
      return '<div class="card" style="padding:36px;text-align:center;color:var(--text-muted);">No chat rooms are available.</div>';
    }
    if (!cmcpState.room || !rooms.some(function (r) { return r.id === cmcpState.room; })) {
      cmcpState.room = rooms[0].id;
    }
    var roomList = rooms.map(function (r) {
      var n = (msgs[r.id] || []).length;
      return '<div class="cmcp-room' + (r.id === cmcpState.room ? ' active' : '') + '" onclick="cmcPortalSetRoom(\'' + esc(r.id) + '\')">' +
        (r.icon ? esc(r.icon) + ' ' : '') + esc(r.name) +
        '<span style="float:right;font-size:11px;color:var(--text-muted);">' + n + '</span></div>';
    }).join('');

    var active = rooms.filter(function (r) { return r.id === cmcpState.room; })[0] || rooms[0];
    var list = (msgs[active.id] || []).slice(-100);
    var body = list.length ? list.map(function (m) {
      var when = '';
      try { when = new Date(m.timestamp).toLocaleString(); } catch (e) {}
      return '<div class="cmcp-msg"><span class="who">' + esc(m.senderName || 'Unknown') + '</span>' +
        '<span class="when">' + esc(when) + '</span>' +
        '<div style="margin-top:2px;white-space:pre-wrap;">' + esc(m.text || '') + '</div></div>';
    }).join('') : '<p style="color:var(--text-muted);padding:16px;">No messages in this room.</p>';

    return '<div class="card"><div class="card-header"><h3>LMS Chat</h3><span class="cmcp-readonly-pill">🔒 Read-only — the CMC cannot post</span></div>' +
      '<div class="cmcp-chat-wrap">' +
      '<div style="display:flex;flex-direction:column;gap:4px;max-height:60vh;overflow:auto;">' + roomList + '</div>' +
      '<div style="max-height:60vh;overflow:auto;padding-right:6px;">' +
      '<div style="font-weight:700;margin-bottom:8px;">' + (active.icon ? esc(active.icon) + ' ' : '') + esc(active.name) + '</div>' +
      body + '</div></div></div>';
  }
  root.cmcPortalSetRoom = function (roomId) {
    cmcpState.room = roomId;
    cmcpRenderPanel();
  };

  /* ---------------- Video Conference (read-only) ---------------- */
  function cmcpVideoPanel() {
    var sessions = arr('classSessions').slice().sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
    var meetings = arr('adminMeetings');
    var h = '<div class="card"><div class="card-header"><h3>Class Sessions</h3><span class="cmcp-readonly-pill">🔒 View only — no hosting or joining</span></div>';
    if (!sessions.length) {
      h += '<p style="color:var(--text-muted);padding:16px;">No class sessions have been scheduled.</p>';
    } else {
      h += '<div style="overflow-x:auto;"><table class="data-table" style="width:100%;">' +
        '<thead><tr><th>Session</th><th>Programme</th><th>Date</th><th>Time</th><th>Duration</th><th>Type</th><th>Status</th></tr></thead><tbody>' +
        sessions.map(function (s) {
          return '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.course || '') + '</td><td>' + esc(s.date || '') + '</td>' +
            '<td>' + esc(s.time || '') + '</td><td>' + esc((s.duration || '') + (s.duration ? ' min' : '')) + '</td>' +
            '<td>' + esc(s.type || '') + '</td><td>' + esc(s.status || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    h += '</div>';

    h += '<div class="card"><div class="card-header"><h3>Meetings</h3><span class="cmcp-readonly-pill">🔒 View only</span></div>';
    if (!meetings.length) {
      h += '<p style="color:var(--text-muted);padding:16px;">No meetings have been scheduled.</p>';
    } else {
      h += '<div style="overflow-x:auto;"><table class="data-table" style="width:100%;">' +
        '<thead><tr><th>Title</th><th>Date</th><th>Time</th><th>Host</th></tr></thead><tbody>' +
        meetings.map(function (m) {
          return '<tr><td>' + esc(m.title || m.name || '') + '</td><td>' + esc(m.date || '') + '</td>' +
            '<td>' + esc(m.time || '') + '</td><td>' + esc(m.host || m.createdBy || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    return h + '</div>';
  }

  /* ---------------- Cashbook (Main Dashboard + Transactions only) ---------------- */
  function cmcpMountCashbook(el) {
    el.innerHTML = '<div class="card" style="margin-bottom:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">' +
      '<div style="font-size:22px;">💼</div>' +
      '<div style="flex:1;min-width:220px;"><div style="font-weight:700;">Cashbook — Main Dashboard &amp; Transactions</div>' +
      '<div style="font-size:12px;color:var(--text-muted);">The CMC view of the Cashbook exposes only the Main Dashboard and the Transactions page, with all editing disabled.</div></div>' +
      '<span class="cmcp-readonly-pill">🔒 View only</span></div>' +
      '<iframe id="cmcCashbookFrame" class="cmcp-frame" title="Cashbook (CMC view)"></iframe>';
    var f = document.getElementById('cmcCashbookFrame');
    if (f && !f.getAttribute('data-src-loaded')) {
      f.src = 'CESTIS.Cashbook.html?view=cmc';
      f.setAttribute('data-src-loaded', '1');
    }
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
