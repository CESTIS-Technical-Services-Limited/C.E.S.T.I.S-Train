/* Unit tests for the Admin Staff access grid — which sections an Admin Staff
   member sees in the nav.

   The grid is the Administrator's (Settings -> Admin Staff Access); every other
   device only receives it. Three things were going wrong, and these tests pin
   the fixes:

     - a received grid REPLACED the defaults, so any page whose key the sender's
       copy did not carry read as undefined — indistinguishable from "not
       permitted" — and quietly vanished from the nav;
     - the sidebar is built once, at login, and the grid usually arrives from
       the cloud a moment after that, so the settings changed while the nav did
       not (a staff member on a fresh device saw no permitted functions at all,
       Video Conference among them, until they signed out and in again);
     - Video Conference defaulted to off, so an install where nobody had opened
       the grid never offered it, even though Admin Staff have their own
       conference page.

   The functions are read straight out of index.html — the LMS keeps its logic
   inline — and run against a stubbed page.

   Run: node tests/admin-staff-access.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* ---------- Pull the grid out of the page ---------- */

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(name) {
  const start = PAGE.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = PAGE.indexOf('{', start); i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (!depth) return PAGE.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

function extractStatement(startsWith, endsWith) {
  const start = PAGE.indexOf(startsWith);
  if (start < 0) throw new Error('index.html no longer declares ' + startsWith);
  const end = PAGE.indexOf(endsWith, start);
  if (end < 0) throw new Error('unterminated declaration ' + startsWith);
  return PAGE.slice(start, end + endsWith.length);
}

const DEFAULTS_SRC = extractStatement('var AS_ACCESS_DEFAULTS = {', '};');
const PAGES_SRC = extractStatement('var asAccessPages = [', '];');
const PERMISSION_SRC = extractStatement('var AS_PAGE_PERMISSION = {', '};');

/* A page-like world. refreshAdminStaffNav() is the real one; the sidebar
   builder it calls is stubbed so we can count the redraws it asks for. */
function makePage(opts) {
  opts = opts || {};
  const sandbox = {
    currentRole: opts.role || 'adminstaff',
    redraws: 0,
    console: { warn: function () {}, log: function () {} },
    Object: Object,
    document: {
      getElementById: function () { return opts.noSidebar ? null : {}; },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; }
    },
    cestisActivePageId: function () { return opts.activePage || null; },
    showPage: function (id) { sandbox.wentTo = id; },
    wentTo: null
  };
  sandbox.buildAdminStaffSidebar = function () { sandbox.redraws++; };
  sandbox.pageAllowedForRole = function (pageId) {
    if (sandbox.currentRole !== 'adminstaff') return true;
    var need = sandbox.AS_PAGE_PERMISSION[pageId];
    if (!need) return true;
    return !!sandbox.adminStaffAccessSettings[need];
  };
  vm.createContext(sandbox);
  vm.runInContext([
    DEFAULTS_SRC, PAGES_SRC, PERMISSION_SRC,
    extractFunction('adminStaffAccessDefaults'),
    extractFunction('applyAdminStaffAccess'),
    extractFunction('refreshAdminStaffNav'),
    'var adminStaffAccessSettings = adminStaffAccessDefaults();'
  ].join('\n\n'), sandbox);
  return sandbox;
}

/* ---------- 1. Every page the grid offers has a default ---------- */
console.log('Every page in the access grid has a setting of its own');

let page = makePage();
const missing = page.asAccessPages
  .map(function (p) { return p.key; })
  .filter(function (k) { return !(k in page.AS_ACCESS_DEFAULTS); });
assertEq(missing.join(','), '', 'no page is left without a default (an absent key reads as "not permitted")');

const gatedMissing = Object.keys(page.AS_PAGE_PERMISSION)
  .map(function (pg) { return page.AS_PAGE_PERMISSION[pg]; })
  .filter(function (k) { return !(k in page.AS_ACCESS_DEFAULTS); });
assertEq(gatedMissing.join(','), '', 'every gated page names a setting that exists');

/* ---------- 2. Video Conference is offered unless it is turned off ---------- */
console.log('Video Conference is offered to Admin Staff by default');

assertEq(page.adminStaffAccessSettings.video, true, 'on where nobody has opened the grid');
assertEq(page.pageAllowedForRole('as-video'), true, 'and the page may be opened');

console.log('An Administrator who turns it off is respected');

page = makePage();
page.applyAdminStaffAccess({ attendance: true, students: true, video: false });
assertEq(page.adminStaffAccessSettings.video, false, 'a saved grid wins over the default');
assertEq(page.pageAllowedForRole('as-video'), false, 'and the page is refused');
assertEq(page.adminStaffAccessSettings.attendance, true, 'the rest of their choices stand');

/* ---------- 3. A received grid merges onto the defaults ---------- */
console.log('A grid saved before a page existed does not hide that page by omission');

page = makePage();
page.applyAdminStaffAccess({ video: true, students: true });   // an older, shorter copy
const undef = Object.keys(page.adminStaffAccessSettings)
  .filter(function (k) { return page.adminStaffAccessSettings[k] === undefined; });
assertEq(undef.join(','), '', 'no setting is left undefined');
assertEq(page.adminStaffAccessSettings.supportmessages, false, 'a key the sender lacked falls back to its default');
assertEq(page.adminStaffAccessSettings.students, true, 'what the sender did carry is adopted');

console.log('Only real booleans are stored');

page = makePage();
page.applyAdminStaffAccess({ video: 'yes', exams: 0, reports: 1 });
assertEq(page.adminStaffAccessSettings.video, true, 'a truthy value becomes true');
assertEq(page.adminStaffAccessSettings.exams, false, 'a falsy one becomes false');
assertEq(page.adminStaffAccessSettings.reports, true, '1 becomes true');

console.log('Nothing at all is not a grid');

page = makePage();
assertEq(page.applyAdminStaffAccess(null), false, 'null changes nothing');
assertEq(page.applyAdminStaffAccess('nope'), false, 'nor does a string');
assertEq(page.adminStaffAccessSettings.video, true, 'the settings in force are untouched');

/* ---------- 4. The nav is redrawn when the grid changes ---------- */
console.log('The nav is redrawn the moment the grid changes');

page = makePage();
assertEq(page.applyAdminStaffAccess({ video: false }), true, 'a change is reported');
assertEq(page.redraws, 1, 'and the sidebar is rebuilt — not left as it was at login');

assertEq(page.applyAdminStaffAccess({ video: false }), false, 'the same grid again is no change');
assertEq(page.redraws, 1, 'and asks for no redraw');

console.log('Somebody who is not Admin Staff is left alone');

page = makePage({ role: 'admin' });
page.applyAdminStaffAccess({ video: false, exams: true });
assertEq(page.redraws, 0, 'an administrator\'s own sidebar is not rebuilt');
assertEq(page.adminStaffAccessSettings.exams, true, 'though the settings are still adopted');

console.log('A page taken away underneath the user does not leave them on it');

page = makePage({ activePage: 'as-video' });
page.applyAdminStaffAccess({ video: false });
assertEq(page.wentTo, 'as-dashboard', 'they are returned to their dashboard');

console.log('A page they keep leaves them where they are');

page = makePage({ activePage: 'as-video' });
page.applyAdminStaffAccess({ video: true, students: true });
assertEq(page.wentTo, null, 'no navigation happens');
assertEq(page.redraws, 1, 'the nav still refreshes around them');

console.log('A redraw before the sidebar exists is harmless');

page = makePage({ noSidebar: true });
assertEq(page.applyAdminStaffAccess({ video: false }), true, 'the settings are still adopted');
assertEq(page.redraws, 0, 'nothing is drawn');

/* ---------- Result ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
