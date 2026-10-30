/* A trainee at home sees the sidebar's LIVE badge when her class goes live.
   Run: node tests/gate-live-badge.test.js

   What used to go wrong: the LIVE badge beside My Classes is redrawn by
   refreshNavLiveBadges when the sidebar is built and after every save. A
   trainee signed in from home (a gate session) receives a class going live
   as new records from the gate (gateAfterApply), never as a save — so the
   class was in her records, "Live Now" on My Classes, and the sidebar badge
   stayed dark for the whole lesson.

   Pinned here, on the dashboard's own gateAfterApply and refreshNavLiveBadges
   read from index.html (with the real CESTISCore.ui.liveSessionsFor): new
   records holding her programme's live class light the badge; records with
   no live class leave it dark. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFunction(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

const TODAY = '2026-10-28';
function phone(arriving) {
  const badge = { hidden: true, title: '', removeAttribute() { this.title = ''; } };
  const me = { id: 'STU-W01', name: 'Tameka Richards', course: 'Welding & Fabrication' };
  const sb = {
    window: null, Array: Array, String: String, console: console,
    document: { querySelectorAll: sel => (sel === '#sidebarNav .nav-live-badge' ? [badge] : []) },
    CESTISCore: Core, localDateStr: () => TODAY, instructorCourseMatch: null,
    currentRole: 'student', currentStudent: me, currentLoggedInUser: { id: 'USR-W01' },
    students: [me], userAccounts: [{ id: 'USR-W01' }], classSessions: [], _syncIndex: {},
    // What the namespace holds after the gate's records were applied.
    gateReloadMemory: () => { sb.classSessions = arriving.slice(); },
    examAttemptsArrived: () => {}, refreshContentDependentViews: () => {}, renderStudentDashboard: () => {},
    updateNotificationDot: () => {}, refreshSyncChip: () => {}
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractFunction('refreshNavLiveBadges') + extractFunction('gateAfterApply'), sb);
  return { sb, badge };
}

console.log('New records from the gate redraw the LIVE badge');
{
  const live = { id: 'CS-1', name: 'Welding Theory — live today', course: 'Welding & Fabrication', date: TODAY, status: 'live' };
  const t = phone([live]);
  t.sb.gateAfterApply({ changed: true });
  assert(t.badge.hidden === false, 'her programme\'s class going live lights the badge');
  assert(t.badge.title === 'A class is live now', 'with its title: ' + t.badge.title);
}
{
  const other = { id: 'CS-2', name: 'Plumbing basics', course: 'Plumbing', date: TODAY, status: 'live' };
  const done = { id: 'CS-3', name: 'Welding Theory', course: 'Welding & Fabrication', date: TODAY, status: 'completed' };
  const t = phone([other, done]);
  t.badge.hidden = false;
  t.sb.gateAfterApply({ changed: true });
  assert(t.badge.hidden === true, 'another programme\'s class, or hers once it has ended, leaves it dark');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
