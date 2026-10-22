/* Every picture says what it shows, or says nothing when it only decorates.

   What was wrong (UI audit, "Alt text and labels for icon-only controls"):
   15 of the dashboard's 24 <img> had no alt at all - profile photos, the
   Centre's logo on the enrolment registers, certificate backgrounds in the
   template editor, the Document Hub's printed image - so a screen reader read
   out a file name or a long data: address. On the sign-in screen it read
   "V", "cloud", "shield", "graduation cap", "books", "clipboard" and
   "classical building" before the words they decorate, and an unnamed image
   inside the Certificate Portal button. School Fee wrote a document's file
   name into its alt unescaped.

   Now: a photo standing on its own is named after the person (escaped); a
   photo printed right beside the person's name is alt="" (it would be read
   twice); logos and certificate backgrounds say what they are; the sign-in
   screen's decorative tiles, emoji and icons are aria-hidden.

   Pinned here from the real files (Node, no browser); the browser suite
   tests/browser/ui-preview-a.js checks the rendered pages and Chromium's
   accessibility tree.

   Run: node tests/ui-image-alt.test.js */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const INDEX = read('index.html');

// Every <img ...> written in a page (markup or a script's template string).
function imgTags(src) {
  // Block comments that quote a tag (a "/*" followed by a space, newline or
  // star - so accept="image/*" is not one).
  const comments = []; const cr = /\/\*[\s*][\s\S]*?\*\//g; let c;
  while ((c = cr.exec(src))) comments.push([c.index, c.index + c[0].length]);
  const out = []; const rx = /<img\b[^>]*>/g; let m;
  while ((m = rx.exec(src))) {
    const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index));
    if (/^\s*\/\//.test(line)) continue;                         // a line comment quoting a tag
    if (comments.some(([a, b]) => a <= m.index && m.index < b)) continue;
    out.push({ tag: m[0], line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

console.log('No picture is left without an alt');
['index.html', 'School.Fee.html', 'CESTIS.Cashbook.html', 'Virement.Request.html', 'Transcript-Grades.html',
 'Staff.Clock.in.html', 'Staff.Payslip.html', 'Student-Progress.html', 'Cert-Transcript-Requests.html'].forEach(f => {
  const missing = imgTags(read(f)).filter(t => !/\balt=/.test(t.tag)).map(t => t.line);
  assert(missing.length === 0, f + ': every <img> has an alt (missing on lines ' + missing.join(', ') + ')');
});
assert(/var img = document\.createElement\('img'\); img\.alt = 'Certificate ' \+ p\.label;/.test(INDEX), 'the certificate preview built in script names its page');

console.log('A photo on its own is the person; beside their name it is decorative');
{
  const has = (re, msg) => assert(re.test(INDEX), msg);
  has(/preview\.innerHTML = '<img src="'\+escapeAttr\(safeUrl\(chatProfile\.profilePic\)\)\+'" alt="'\+escapeAttr\(name \|\| 'Profile picture'\)\+'">';/, 'Edit profile: the current photo is the person\'s name, escaped');
  has(/\(profile\.profilePic \? '<img src="'\+escapeAttr\(safeUrl\(profile\.profilePic\)\)\+'" alt="'\+escapeAttr\(user\.name\)\+'">'/, 'My Chat Profile: the photo is the person\'s name, escaped');
  has(/sa\.innerHTML = '<img src="'\+escapeAttr\(safeUrl\(cp\.profilePic\)\)\+'" alt="" /, 'sidebar: decorative (the name is beside it)');
  has(/avatar\.innerHTML = '<img src="'\+escapeAttr\(safeUrl\(chatProfile\.profilePic\)\)\+'" alt="" /, 'sidebar after a photo change: decorative');
  has(/<img src="'\+escapeAttr\(safeUrl\(otherProf\.profilePic\)\)\+'" alt="" /, 'chat room list: decorative');
  has(/headerAvatar\.innerHTML = '<img src="'\+escapeAttr\(safeUrl\(dmOtherProf\.profilePic\)\)\+'" alt="" /, 'chat header: decorative');
  has(/<div class="member-avatar"><img src="'\+escapeAttr\(safeUrl\(prof\.profilePic\)\)\+'" alt=""><\/div>/, 'Chat Info members: decorative');
  assert((INDEX.match(/alt="New profile picture \(preview\)"/g) || []).length === 2, 'both new-photo previews say what they are');
}

console.log('Logos, certificate backgrounds and documents say what they are');
{
  assert(/'<img src="' \+ logo\.dataUrl \+ '" alt="Institution logo" /.test(INDEX), 'enrolment registers: Institution logo');
  assert(/alt="Certificate page ' \+ \(\/2\/\.test\(previewId\) \? '2' : '1'\) \+ ' background \(preview\)"/.test(INDEX), 'template editor: the chosen background, by page');
  assert(/alt="Certificate page 1 background"/.test(INDEX) && /alt="Certificate page 2 background"/.test(INDEX), 'template editor: the saved backgrounds, by page');
  assert(/<img src="' \+ escapeAttr\(docHubFileUrl\(doc\)\) \+ '" alt="' \+ escapeAttr\(doc\.title\) \+ '" onload=/.test(INDEX), 'Document Hub print window: the document\'s title, escaped');
  assert((read('CESTIS.Cashbook.html').match(/alt="Centre logo"/g) || []).length === 3, 'Cashbook documents: Centre logo (3)');
  assert(/class="vlp-logo" alt="Centre logo"/.test(read('Virement.Request.html')), 'Virement form: Centre logo');
  const fee = read('School.Fee.html');
  assert((fee.match(/alt="\$\{feeAttr\(doc\.fileName\)\}"/g) || []).length === 2 && !/alt="\$\{doc\.fileName\}"/.test(fee), 'School Fee documents: the file name, now escaped');
}

console.log('The sign-in screen\'s decorative pictures are hidden from screen readers');
{
  const landing = INDEX.slice(INDEX.indexOf('<div id="landingPage"'), INDEX.indexOf('<div class="landing-footer">'));
  assert(/<div class="landing-logo-icon" aria-hidden="true">V<\/div>/.test(landing), 'the "V" tile');
  assert(/<span class="sync-icon" aria-hidden="true">☁️<\/span>/.test(landing), 'the sync cloud');
  const icons = landing.match(/<div class="role-icon"[^>]*>/g) || [];
  assert(icons.length === 5 && icons.every(t => /aria-hidden="true"/.test(t)), 'all five role-card emoji (' + icons.length + ')');
  const svgs = landing.match(/<svg\b[^>]*>/g) || [];
  assert(svgs.length >= 3 && svgs.every(t => /aria-hidden="true"/.test(t) && /focusable="false"/.test(t)), 'every icon graphic on the sign-in screen (' + svgs.length + ')');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
