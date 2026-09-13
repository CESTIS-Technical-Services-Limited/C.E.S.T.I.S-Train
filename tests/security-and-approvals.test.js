/* Two things a school system must not get wrong: what a person types must never
   run as code, and money must not move without the signatures the Centre's own
   form asks for.

   WHAT A PERSON TYPES. Five Admin Staff renderers built their HTML by joining
   strings together with no escaping, while the other ninety-odd places in the
   same file escaped properly. A trainee chooses their own full name when they
   register, and instructors write announcement and calendar text. A name of the
   shape <img src=x onerror=...> therefore RAN in the Admin Staff session —
   demonstrated in a real browser before this was fixed. The escaping helpers
   also assumed a string, so an exam duration (a number) threw straight out of
   whatever was building the page.

   MONEY AND SIGNATURES. The virement approval panel was gated by a PIN written
   into the page in plain sight ("1234"), and every decision was stamped with the
   literal word "Admin" — so nothing recorded who approved anything, one person
   could approve alone, and the two signatures the printed form has lines for
   existed only as blank ink. Worse, the status changed nothing: a REFUSED
   virement still moved the budget figures, because every request in the quarter
   was folded in regardless of what had been decided. An approved request could
   also be edited to any amount and kept its approval, and the page created
   seventeen financial requests out of nothing on any device with an empty store.

   Run: node tests/security-and-approvals.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const DASHBOARDS = ['index.html', 'Offline System/index.html'];
const VIREMENTS = ['Virement.Request.html', 'Offline System/Virement.Request.html'];

function extractFunction(src, name, where) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(where + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

/* ================= 1. Typed text is escaped ================= */
console.log('A name someone typed cannot become markup');

const RENDERERS = ['renderAsExams', 'renderAsAttendance', 'renderAsAnnouncements',
                   'renderAsCalendar', 'renderAsCertificates'];

DASHBOARDS.forEach(where => {
  const src = read(where);

  RENDERERS.forEach(fn => {
    const body = extractFunction(src, fn, where);
    // Every value interpolated into the markup must pass through an escaper.
    const rawInterpolations = (body.match(/\+\s*(?:[a-z]+)\.(name|title|course|body|author|studentName|studentId|date|time|type|certNo|certDate|duration|priority)\b/g) || []);
    assert(rawInterpolations.length === 0,
      where + ': ' + fn + ' escapes every value a person typed (found ' +
      rawInterpolations.length + ' raw: ' + rawInterpolations.slice(0, 3).join(', ') + ')');
    assert(/escapeHtml\(/.test(body), where + ': ' + fn + ' uses escapeHtml()');
  });

  // The escapers must survive a value that is not a string.
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(extractFunction(src, 'escapeHtml', where) + '\n' + extractFunction(src, 'escapeAttr', where), sb);
  sb.out = null;
  assert(vm.runInContext("escapeHtml('<img src=x onerror=alert(1)>')", sb) ===
    '&lt;img src=x onerror=alert(1)&gt;', where + ': escapeHtml neutralises a tag');
  assert(vm.runInContext("escapeHtml(45)", sb) === '45',
    where + ': escapeHtml copes with a number — an exam duration used to throw out of the renderer');
  assert(vm.runInContext("escapeHtml(null)", sb) === '', where + ': and with nothing at all');
  assert(vm.runInContext("escapeAttr(45)", sb) === '45', where + ': escapeAttr copes with a number too');
  assert(vm.runInContext("escapeHtml(\"it's\")", sb).indexOf("'") === -1,
    where + ': a quote cannot close an attribute');
});

/* ================= 2. The virement needs two signatures ================= */
console.log('A virement moves money only when two different people have signed');

VIREMENTS.forEach(where => {
  const src = read(where);

  // The PIN is gone, root and branch.
  assert(src.indexOf('ADMIN_PIN') === -1,
    where + ': the PIN written into the page in plain sight is gone');
  assert(src.indexOf('verifyAdminPin') === -1, where + ': and so is the function that checked it');
  assert(src.indexOf("r.approvedBy = 'Admin'") === -1,
    where + ': decisions are no longer stamped with the word "Admin" instead of a person');

  // The signer comes from the session the dashboard writes.
  assert(/function vrSignedInUser\(/.test(src), where + ': the signer is the person signed in');
  assert(/voctrain_sessionUserId/.test(src), where + ': read from the shared session');
  assert(/function vrMaySign\(/.test(src), where + ': and only an administrator or board member may sign');

  // Two signatures, from two people, before anything moves.
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(extractFunction(src, 'vrSignatures', where) + '\n'
    + extractFunction(src, 'vrHasSigned', where) + '\n'
    + extractFunction(src, 'vrIsApproved', where), sb);

  const one = { status: 'Approved', signatures: [{ id: 'U-A', name: 'Chair' }] };
  const two = { status: 'Approved', signatures: [{ id: 'U-A', name: 'Chair' }, { id: 'U-B', name: 'Second' }] };
  const pending = { status: 'Pending', signatures: [] };
  const rejected = { status: 'Rejected', signatures: [{ id: 'U-A', name: 'Chair' }] };
  sb.one = one; sb.two = two; sb.pending = pending; sb.rejected = rejected;

  assert(vm.runInContext('vrIsApproved(two)', sb) === true,
    where + ': two signatures from two people approve it');
  assert(vm.runInContext('vrIsApproved(one)', sb) === false,
    where + ': one signature is not an approval, whatever the status says');
  assert(vm.runInContext('vrIsApproved(pending)', sb) === false, where + ': a pending request is not approved');
  assert(vm.runInContext('vrIsApproved(rejected)', sb) === false, where + ': nor is a refused one');
  assert(vm.runInContext("vrHasSigned(one, 'U-A')", sb) === true,
    where + ': a person who has signed is recognised, so they cannot sign twice');
  assert(vm.runInContext("vrHasSigned(one, 'U-B')", sb) === false,
    where + ': and somebody who has not signed still can');

  // Money follows approval, not the mere existence of a request.
  assert(/quarterRequests\.filter\(vrIsApproved\)\.forEach/.test(src),
    where + ': the budget fold counts only approved virements — a refused one used to move the money anyway');
  assert(/let totalVired = quarterRequests\.filter\(vrIsApproved\)/.test(src),
    where + ': and so does the Total Vired figure');

  // Editing a ruled-on request sends it back for signing.
  assert(/if \(existing\.status && existing\.status !== 'Pending'\) \{[\s\S]{0,200}existing\.status = 'Pending';[\s\S]{0,200}existing\.signatures = \[\];/.test(src),
    where + ': editing a virement that was already ruled on clears the ruling and its signatures');

  // Nothing invents financial records.
  assert(!/^\s*preloadFromDocData\(\);\s*$/m.test(src),
    where + ': nothing calls the seed, so an empty store no longer fills with requests nobody raised');

  // Rulings merge by the moment they were made.
  assert(/approvalAt/.test(src),
    where + ': a ruling carries the moment it was made, so two decisions on the same day can be ordered');
  assert(src.indexOf('cr.approvalDate > local.approvalDate') === -1,
    where + ': the date-string comparison that left two devices disagreeing for ever is gone');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
