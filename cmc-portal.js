/* ============================================================================
   cmc-portal.js — CMC Board (Community Management Committee) view-only portal.

   The CMC oversees the Centre but does not operate it, so every panel here is
   STRICTLY READ-ONLY: the portal renders from the shared data core and exposes
   no control that creates, edits or deletes anything.

   ONE deliberate exception, and it is not in these panels: a virement moves
   money between budget lines and the board is the body entitled to settle it,
   so the board's dashboards carry a ruling. It takes TWO signatures — the
   Chairperson rules, a second board member countersigns — and only then does
   the decision reach the Virement Requests register, in the four approval
   fields that page already writes. A ruling awaiting its second signature
   lives in the Board's own minute book, never in the register: put it there
   and the Centre would act on an approval nobody had yet seconded. See
   cmcVirementStage below.

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

  /* ==========================================================================
     OVERSIGHT DATA — read from the collections the operating pages own.

     The CMC dashboards used to sit empty behind a "Sync Drive Data" button,
     scraping four Google Drive FOLDERS for whatever JSON happened to be newest
     in each. A board member who never pressed the button saw nothing; one
     without a Drive token could see nothing at all. Meanwhile the very same
     records were already on the device, under the keys the operating pages
     write and page-cloud keeps current.

     So the board reads those keys instead — the ordinary shared-collection
     route (see CESTISCore.pageCloud.sharedSources). READ-ONLY by construction:
     these functions take a storage map and return rows. Nothing here writes.

     Every parser is deliberately forgiving about field names: four different
     apps wrote these blobs over several years and each spells things its own
     way. A missing field costs one column, never the row.
     ========================================================================== */

  /* The operating pages whose collections the board reads, and the page-cloud
     file each one publishes. Used to pull current copies without asking the
     board member to press anything. */
  var CMC_SHARED_FILES = [
    { key: 'cashbook', file: 'CESTIS_Cashbook.json', page: 'Cashbook',
      keys: ['cesti_cashbook_data', 'cestis_active_quarter'], prefixes: ['cestis_quarter_', 'cestis_budget_'] },
    { key: 'payslip', file: 'CESTIS_Staff_Payslips.json', page: 'Staff Payslips', keys: ['cestisPayroll'] },
    { key: 'clockin', file: 'CESTIS_Staff_TimeClock.json', page: 'Staff Time Clock', keys: ['cestisStaffMembers', 'cestisTimeRecords'] },
    { key: 'virement', file: 'CESTIS_Virement_Requests.json', page: 'Virement Requests', keys: ['cesti_virements'] }
  ];

  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function parseJson(raw, dflt) {
    if (raw == null) return dflt;
    if (typeof raw !== 'string') return raw;
    try { var v = JSON.parse(raw); return v == null ? dflt : v; } catch (e) { return dflt; }
  }
  /* A stored collection may be an array, or an object wrapping one under any of
     several names — every app made its own choice. */
  function listOf(v, names) {
    if (Array.isArray(v)) return v;
    if (!v || typeof v !== 'object') return [];
    for (var i = 0; i < (names || []).length; i++) {
      if (Array.isArray(v[names[i]])) return v[names[i]];
    }
    return [];
  }
  function ymd(v) {
    var s = String(v == null ? '' : v);
    var m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? m[0] : '';
  }

  /* Cashbook transactions across every stored quarter. The cashbook keeps one
     blob per quarter (cestis_quarter_<FY>_Q<n>), so the board's view of the
     book is the union of them, with deleted rows and voided cheques honoured
     exactly as the cashbook's own totals honour them: a voided cheque counts
     ZERO, it does not vanish. */
  function cmcCashbookRows(storeMap) {
    var map = storeMap || {}, rows = [];
    Object.keys(map).forEach(function (k) {
      var m = /^cestis_quarter_(.+)_Q(\d)$/.exec(k);
      if (!m) return;
      var blob = parseJson(map[k], null);
      if (!blob || typeof blob !== 'object') return;
      var dropped = {};
      (Array.isArray(blob.deletedTxnIds) ? blob.deletedTxnIds : []).forEach(function (id) { dropped[String(id)] = 1; });
      (Array.isArray(blob.transactions) ? blob.transactions : []).forEach(function (t) {
        if (!t || t.id == null || dropped[String(t.id)]) return;
        var voided = String(t.category || '') === 'Cancelled';
        var dep = num(t.deposit), pay = num(t.payment);
        rows.push({
          id: String(t.id), fy: m[1], quarter: 'Q' + m[2], period: m[1] + ' Q' + m[2],
          date: ymd(t.date), details: String(t.details || ''), cheque: String(t.cheque || ''),
          category: String(t.category || 'Uncategorised'),
          deposit: dep, payment: pay, amount: dep > 0 ? dep : pay,
          type: voided ? 'cancelled' : (dep > 0 ? 'income' : 'expense'),
          voided: voided
        });
      });
    });
    return rows.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  }

  /* Income / expenditure / balance over a set of cashbook rows. A cancelled
     cheque contributes nothing — the same rule the cashbook's own calcTotals
     applies — so the board's figure and the Centre's figure agree. */
  function cmcCashSummary(rows) {
    var income = 0, expense = 0, cancelled = 0;
    (rows || []).forEach(function (r) {
      if (!r) return;
      if (r.voided || r.type === 'cancelled') { cancelled++; return; }
      if (r.type === 'income') income += num(r.amount); else expense += num(r.amount);
    });
    return { count: (rows || []).length, income: income, expense: expense, balance: income - expense, cancelled: cancelled };
  }

  /* Payslip runs → one row per person per pay cycle. */
  function cmcPayrollRows(raw) {
    var blob = parseJson(raw, null), rows = [];
    if (!blob || typeof blob !== 'object') return rows;
    listOf(blob.payrollRuns, ['runs']).forEach(function (run) {
      if (!run) return;
      var date = ymd(run.date) || String(run.date || '');
      listOf(run.results, ['entries', 'lines']).forEach(function (r) {
        if (!r) return;
        var gross = num(r.gross != null ? r.gross : r.grossPay);
        var net = num(r.net != null ? r.net : (r.netPay != null ? r.netPay : r.takeHome));
        rows.push({
          date: date, period: date.slice(0, 7),
          name: String(r.empName || r.name || r.employee || 'Unnamed'),
          position: String(r.position || r.role || r.jobTitle || ''),
          gross: gross, deductions: num(r.deductions != null ? r.deductions : (gross && net ? gross - net : 0)),
          net: net || gross, amount: net || gross
        });
      });
    });
    return rows.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  }

  /* Clock-in sessions → one row per session, hours worked resolved. */
  function cmcClockRows(recordsRaw, staffRaw) {
    var records = listOf(parseJson(recordsRaw, []), ['records', 'timeRecords', 'entries']);
    var staff = listOf(parseJson(staffRaw, []), ['staff', 'staffMembers', 'members']);
    var nameById = {};
    staff.forEach(function (s) {
      if (!s) return;
      var id = s.id != null ? String(s.id) : (s.staffId != null ? String(s.staffId) : '');
      if (id) nameById[id] = String(s.fullName || s.name || s.username || '');
    });
    return records.map(function (r) {
      if (!r) return null;
      var sid = r.staffId != null ? String(r.staffId) : '';
      var inAt = r.clockIn || r.in || null, outAt = r.clockOut || r.out || null;
      var hours = num(r.hours != null ? r.hours : r.totalHours);
      if (!hours && inAt && outAt) {
        var ms = Date.parse(outAt) - Date.parse(inAt);
        if (isFinite(ms) && ms > 0) hours = Math.round(ms / 36000) / 100;
      }
      return {
        id: String(r.id == null ? '' : r.id), staffId: sid,
        name: String(r.staffName || nameById[sid] || r.name || 'Unnamed'),
        workType: String(r.workType || r.type || ''),
        date: ymd(r.date) || ymd(inAt), period: (ymd(r.date) || ymd(inAt)).slice(0, 7),
        clockIn: inAt || '', clockOut: outAt || '',
        status: String(r.status || (outAt ? 'completed' : 'working')),
        hours: hours, amount: hours
      };
    }).filter(Boolean).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  }

  /* Virement requests → one row each, with the budget lines counted. */
  function cmcVirementRows(raw) {
    var list = listOf(parseJson(raw, []), ['requests', 'virements', 'entries']);
    return list.map(function (v) {
      if (!v) return null;
      var lines = listOf(v.lines, ['items']);
      return {
        id: String(v.id == null ? '' : v.id), date: ymd(v.date),
        period: (v.fy ? String(v.fy) : '') + (v.quarter ? ' Q' + String(v.quarter).replace(/^Q/i, '') : ''),
        project: String(v.project || v.projectName || ''),
        requestedBy: String(v.requestedBy || v.requester || ''),
        status: String(v.status || 'Pending'),
        // Who ruled and why: without these the board sees a status with nobody
        // behind it, and its own rulings read as though they came from nowhere.
        approvedBy: String(v.approvedBy || ''),
        approvalDate: String(v.approvalDate || ''),
        approvalComment: String(v.approvalComment || ''),
        lines: lines.length,
        from: lines.map(function (l) { return (l && l.fromName) || ''; }).filter(Boolean).join(', '),
        to: lines.map(function (l) { return (l && l.toName) || ''; }).filter(Boolean).join(', '),
        amount: num(v.total != null ? v.total : v.amount)
      };
    }).filter(Boolean).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  }

  /* --- Filtering: the board decides what it wants to look at ---------------
     One filter shape for every table so a board member learns it once:
       { search, from, to, <field>: value }
     'all' and blank mean "no restriction". Dates are compared as YYYY-MM-DD
     strings, which sort correctly and need no timezone to be right. */
  function cmcFilterRows(rows, filter) {
    var f = filter || {};
    var q = String(f.search == null ? '' : f.search).trim().toLowerCase();
    var from = ymd(f.from), to = ymd(f.to);
    var fields = Object.keys(f).filter(function (k) {
      return k !== 'search' && k !== 'from' && k !== 'to' &&
        f[k] != null && f[k] !== '' && String(f[k]).toLowerCase() !== 'all';
    });
    return (rows || []).filter(function (r) {
      if (!r) return false;
      if (from && (!r.date || String(r.date) < from)) return false;
      if (to && (!r.date || String(r.date) > to)) return false;
      for (var i = 0; i < fields.length; i++) {
        if (String(r[fields[i]] == null ? '' : r[fields[i]]).toLowerCase() !== String(f[fields[i]]).toLowerCase()) return false;
      }
      if (!q) return true;
      var hay = '';
      for (var k in r) {
        if (!Object.prototype.hasOwnProperty.call(r, k)) continue;
        if (r[k] != null && typeof r[k] !== 'object') hay += String(r[k]).toLowerCase() + ' ';
      }
      return hay.indexOf(q) !== -1;
    });
  }

  /* --- Virement approval: the one thing the board DECIDES ------------------

     Everything else here is oversight — the board reads books it does not
     operate. A virement moves money between budget lines, and the board is the
     body entitled to settle it, so this is a deliberate, audited exception to
     the read-only rule and the only write the board can make.

     Recorded in exactly the fields the Virement Requests page already writes
     (status / approvedBy / approvalDate / approvalComment), because every merge
     in that page resolves a Pending record against a decided one by taking the
     DECISION. Writing anything else here would leave the board's ruling
     invisible to the page that has to act on it. */
  var CMC_DECISIONS = ['Approved', 'Rejected'];

  /* TWO SIGNATURES, and the register never sees half of one.

     The Chairperson rules; a second board member countersigns; only then does
     the decision go into the Virement Requests register. A half-finished
     ruling is kept in the Board's OWN minute book (cestis_cmc_rulings), never
     in the register — put it there and the Centre would act on an approval
     that nobody had yet seconded.

     Stages, from a request and the Board's minute for it:
       pending               nobody has ruled — the Chair's move
       awaiting-countersign  the Chair has ruled, a second signature is due
       settled               both signatures given; the register carries it */
  function cmcVirementStage(row, ruling) {
    if (row && String(row.status || 'Pending') !== 'Pending') return 'settled';
    if (ruling && ruling.decision && ruling.counterByUsername) return 'settled';
    if (ruling && ruling.decision) return 'awaiting-countersign';
    return 'pending';
  }

  function cmcRulingFor(rulings, id) {
    var book = (rulings && typeof rulings === 'object') ? rulings : {};
    return book[String(id)] || null;
  }

  function actorOf(a) {
    a = a || {};
    return {
      name: String(a.name == null ? '' : a.name).trim(),
      username: String(a.username == null ? '' : a.username).trim().toLowerCase(),
      isChair: a.isChair === true
    };
  }

  /* Stage one: the Chairperson rules. */
  function cmcRuleVirement(row, ruling, decision, actor, nowISO, comment) {
    var who = actorOf(actor);
    var text = String(comment == null ? '' : comment).trim();
    if (!row) return { ok: false, reason: 'That request could not be found.' };
    if (!who.isChair) return { ok: false, reason: 'Only the Board Chairperson rules on a virement. A second board member countersigns afterwards.' };
    if (!who.username) return { ok: false, reason: 'A ruling has to be attributable to a named account.' };
    if (CMC_DECISIONS.indexOf(decision) === -1) return { ok: false, reason: 'A virement is either Approved or Rejected.' };
    var stage = cmcVirementStage(row, ruling);
    // A settled request is history. Re-deciding it would silently overwrite
    // whoever ruled first — if the board changes its mind that is a new
    // request, raised and minuted like any other.
    if (stage === 'settled') {
      return { ok: false, reason: 'This request was already ' + String(row.status || (ruling && ruling.decision) || 'decided').toLowerCase() +
        ' by ' + ((row && row.approvedBy) || (ruling && ruling.by) || 'someone') + '. It cannot be decided twice.' };
    }
    if (stage === 'awaiting-countersign') {
      return { ok: false, reason: 'You already ruled on this request. It is waiting for a second board member to countersign.' };
    }
    // A refusal without a reason tells the Centre nothing about what to fix.
    if (decision === 'Rejected' && !text) return { ok: false, reason: 'Say why the request is being rejected.' };
    return {
      ok: true,
      ruling: {
        decision: decision,
        by: who.name || 'Chairperson',
        byUsername: who.username,
        at: String(nowISO || ''),
        comment: text
      }
    };
  }

  /* Stage two: a DIFFERENT board member countersigns, and the decision becomes
     the register's. The patch is the four fields Virement.Request.html reads —
     naming both signatures, because a ruling nobody can trace back to two
     people is not a countersigned ruling. */
  function cmcCountersignVirement(row, ruling, actor, nowISO) {
    var who = actorOf(actor);
    if (!row) return { ok: false, reason: 'That request could not be found.' };
    if (!ruling || !ruling.decision) return { ok: false, reason: 'The Chairperson has not ruled on this request yet.' };
    if (cmcVirementStage(row, ruling) === 'settled') return { ok: false, reason: 'This request is already settled.' };
    if (!who.username) return { ok: false, reason: 'A countersignature has to be attributable to a named account.' };
    // The whole point of a second signature is that it is a second person.
    if (who.username === String(ruling.byUsername || '').toLowerCase()) {
      return { ok: false, reason: 'You cannot countersign your own ruling — a second board member has to.' };
    }
    var counter = {
      decision: ruling.decision,
      by: ruling.by, byUsername: ruling.byUsername, at: ruling.at, comment: ruling.comment || '',
      counterBy: who.name || 'Board Member',
      counterByUsername: who.username,
      counterAt: String(nowISO || '')
    };
    return {
      ok: true,
      ruling: counter,
      patch: {
        status: counter.decision,
        approvedBy: counter.by + ' (CMC Chair), countersigned by ' + counter.counterBy + ' (CMC Board)',
        approvalDate: String(nowISO || '').slice(0, 10),
        approvalComment: counter.comment
      }
    };
  }

  /* The Chair may take back a ruling that has not been countersigned. Without
     this a mistaken ruling nobody will second leaves the request stuck: not
     pending, not settled, and impossible to raise again. */
  function cmcWithdrawRuling(row, ruling, actor) {
    var who = actorOf(actor);
    if (!ruling || !ruling.decision) return { ok: false, reason: 'There is no ruling to withdraw.' };
    if (cmcVirementStage(row, ruling) === 'settled') return { ok: false, reason: 'A countersigned decision cannot be withdrawn.' };
    if (!who.isChair || who.username !== String(ruling.byUsername || '').toLowerCase()) {
      return { ok: false, reason: 'Only the Chairperson who made the ruling can withdraw it.' };
    }
    return { ok: true };
  }

  /* Write a ruling into the Board's minute book (or remove it), returning the
     new book. Pure: the book handed in is never mutated. */
  function cmcApplyRuling(rulings, id, ruling) {
    var book = (rulings && typeof rulings === 'object' && !Array.isArray(rulings)) ? rulings : {};
    var out = {};
    Object.keys(book).forEach(function (k) { out[k] = book[k]; });
    if (ruling) out[String(id)] = ruling; else delete out[String(id)];
    return out;
  }

  /* Who is signing: the logged-in account, and whether the Centre has made
     them Chairperson. Exactly one account carries the chair. */
  function cmcSigner(user) {
    var u = user || {};
    return { name: String(u.name || ''), username: String(u.username || ''), isChair: u.cmcChair === true };
  }
  function cmcChairOf(accounts) {
    var list = Array.isArray(accounts) ? accounts : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].role === 'cmc' && list[i].cmcChair === true && list[i].status !== 'inactive') return list[i];
    }
    return null;
  }

  /* Apply a decision to the stored register, touching ONLY that request and
     leaving every other record byte-identical — the board is settling one
     virement, not rewriting the Centre's register. Returns the new JSON string,
     or null when the id is not there (so a caller never writes back a register
     it failed to change). */
  function cmcApplyVirementDecision(raw, id, patch) {
    var list = parseJson(raw, null);
    if (!Array.isArray(list)) return null;
    var found = false;
    var out = list.map(function (v) {
      if (!v || String(v.id) !== String(id) || found) return v;
      found = true;
      var copy = {};
      Object.keys(v).forEach(function (k) { copy[k] = v[k]; });
      Object.keys(patch || {}).forEach(function (k) { copy[k] = patch[k]; });
      return copy;
    });
    return found ? JSON.stringify(out) : null;
  }

  function cmcPendingVirements(rows) {
    return (rows || []).filter(function (r) { return String((r && r.status) || 'Pending') === 'Pending'; });
  }

  /* The distinct values of a field, for a filter dropdown — sorted, blanks
     dropped, so the board only ever sees choices that select something. */
  function cmcFilterOptions(rows, field) {
    var seen = {}, out = [];
    (rows || []).forEach(function (r) {
      var v = r && r[field];
      if (v == null || v === '') return;
      var s = String(v);
      if (seen[s]) return;
      seen[s] = 1; out.push(s);
    });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }

  var api = {
    CMC_ALLOWED_PANELS: CMC_ALLOWED_PANELS,
    CMC_ALLOWED_CASHBOOK_PAGES: CMC_ALLOWED_CASHBOOK_PAGES,
    CMC_SHARED_FILES: CMC_SHARED_FILES,
    cmcPanelAllowed: cmcPanelAllowed,
    cmcCashbookPageAllowed: cmcCashbookPageAllowed,
    cmcStudentSummary: cmcStudentSummary,
    cmcAverages: cmcAverages,
    cmcCashbookRows: cmcCashbookRows,
    cmcCashSummary: cmcCashSummary,
    cmcPayrollRows: cmcPayrollRows,
    cmcClockRows: cmcClockRows,
    cmcVirementRows: cmcVirementRows,
    cmcVirementStage: cmcVirementStage,
    cmcRulingFor: cmcRulingFor,
    cmcRuleVirement: cmcRuleVirement,
    cmcCountersignVirement: cmcCountersignVirement,
    cmcWithdrawRuling: cmcWithdrawRuling,
    cmcApplyRuling: cmcApplyRuling,
    cmcSigner: cmcSigner,
    cmcChairOf: cmcChairOf,
    cmcApplyVirementDecision: cmcApplyVirementDecision,
    cmcPendingVirements: cmcPendingVirements,
    cmcFilterRows: cmcFilterRows,
    cmcFilterOptions: cmcFilterOptions
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CESTISCmc = api;          // the dashboards in index.html read through this
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
