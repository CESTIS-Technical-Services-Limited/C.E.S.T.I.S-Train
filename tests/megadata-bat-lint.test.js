/* MegaData — operator .bat scripts lint. cmd.exe ends a bracketed if-block
   at the FIRST unescaped ')' — even one inside a message — and a dangling
   remainder aborts the whole script the instant it is parsed, so the window
   "opens and closes by itself" with no error the operator can read. That is
   exactly what happened live with step 2 (the "(nodejs.org, LTS)" message).
   This lint bans ANY parenthesis inside any block, one-line or multi-line,
   in every root .bat, so the bug class cannot come back.
   Run: node tests/megadata-bat-lint.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function section(t) { console.log(t); }

function lintBat(text, name) {
  const errs = [];
  let depth = 0;
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    const where = name + ':' + (i + 1);
    if (depth > 0) {
      if (t === ')') { depth--; return; }
      if (/^\)\s*else\s*\($/i.test(t)) return; // ") else (" keeps depth
      if (/[()]/.test(t)) errs.push(where + ' — parenthesis inside a block: ' + t);
      return;
    }
    const one = t.match(/^if\b[^(]*\((.*)$/i);
    if (one) {
      const rest = one[1];
      if (/\)/.test(rest)) {
        const inner = rest.slice(0, rest.lastIndexOf(')'));
        if (/[()]/.test(inner)) errs.push(where + ' — parenthesis inside a one-line if-block: ' + t);
      } else depth++;
      return;
    }
    if (/\($/.test(t)) depth++;
  });
  if (depth !== 0) errs.push(name + ' — unbalanced blocks (depth ' + depth + ' at end of file)');
  return errs;
}

section('The lint itself catches the live failure shapes');
ok(lintBat('if errorlevel 1 ( echo Install Node first (nodejs.org, LTS) then run again. & pause & exit /b 1 )', 'x.bat').length === 1,
  'the exact live step-2 line is rejected');
ok(lintBat('if exist f (\n  echo hello (world)\n)', 'x.bat').length === 1,
  'a parenthesised message inside a multi-line block is rejected');
ok(lintBat('if exist f (\n  echo hello world\n) else (\n  echo bye\n)', 'x.bat').length === 0,
  'clean multi-line blocks with else pass');
ok(lintBat('echo (this is fine - outside any block)', 'x.bat').length === 0,
  'parentheses OUTSIDE blocks are allowed');

section('Every operator .bat in the repo is clean');
const root = path.join(__dirname, '..');
const bats = fs.readdirSync(root).filter(f => f.toLowerCase().endsWith('.bat'));
ok(bats.length >= 3, 'the three migration scripts are present — found: ' + bats.join(', '));
for (const b of bats) {
  const errs = lintBat(fs.readFileSync(path.join(root, b), 'utf8'), b);
  ok(errs.length === 0, b + ' has no parentheses inside blocks' + (errs.length ? '\n    ' + errs.join('\n    ') : ''));
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
