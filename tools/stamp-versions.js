#!/usr/bin/env node
/* ============================================================================
   tools/stamp-versions.js — the ?v= tag on every shared file a page loads,
   made from that file's own content.

   WHY THIS EXISTS
   ---------------
   A browser keeps a copy of cestis-core.js (and the other shared scripts and
   stylesheets) and reuses it until the address changes. So every page asks
   for `cestis-core.js?v=<tag>`, and the tag has to change whenever the file
   does. It used to be bumped by hand on every page: 232 hand-kept tags in 46
   files, and the bump was missed in 21 of 23 changes to cestis-core.js — a
   page then ran new code against an old shared file ("… is not defined").

   Now the tag IS the file: the first 8 hex digits of the SHA-256 of its bytes.
   This tool rewrites every `<file>?v=<anything>` in every page to that, so a
   changed file gets a new tag on every page that loads it, and an unchanged
   one keeps its tag (browsers keep their copy).

   It reads every .html page in the repository (the root pages, Pages/*.html
   and any other folder) except "Offline System/" — that folder is generated
   from these pages byte for byte by tools/build-offline.js, which runs this
   tool first. A tag is stamped wherever a local file name is followed by
   ?v= — in a <script src>, a <link href>, or a quoted name in a page's own
   script (a file loaded on demand) — when that file exists next to the page.

   USE
     node tools/stamp-versions.js           rewrite the tags (npm run stamp)
     node tools/stamp-versions.js --check   change nothing; list every tag that
                                            does not match its file, every local
                                            shared script or stylesheet loaded
                                            with no tag, and exit 1 if any
   `npm run build:offline` runs it before regenerating the Offline System, and
   tests/version-tags.test.js fails when a tag does not match.

   Zero dependencies — plain Node.
   ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

/* Folders that hold no pages of the site. */
const SKIP_DIRS = /^(?:\.|node_modules$|tests$|docs$|tools$|Offline System$|User Login$)/;

/* `name.js?v=tag` (or .css …) after a quote, a bracket, a space or '='. The
   name is a relative path inside the site: no scheme, no leading slash. */
const TAG_RX = /(["'(=\s])((?:\.\.?\/)?[A-Za-z0-9_@%~.\/-]+\.(?:js|css|json|svg|png|webmanifest))\?v=([A-Za-z0-9._-]*)/g;

/* A local script or stylesheet tag. vendor/ files carry their version in their
   name (vendor/jspdf-2.5.1.umd.min.js) and never change, so they need no tag. */
const LOCAL_ASSET_RX = /<(?:script\b[^>]*\bsrc|link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*\bhref)\s*=\s*["']([^"':]+\.(?:js|css))(\?[^"']*)?["']/gi;

function hashOf(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 8);
}

/* Every page of the site under `base` (default: the repository), as paths
   relative to it. */
function pages(base) {
  base = base || ROOT;
  const out = [];
  (function walk(dir) {
    fs.readdirSync(path.join(base, dir), { withFileTypes: true }).forEach(ent => {
      const rel = dir ? dir + '/' + ent.name : ent.name;
      if (ent.isDirectory()) { if (!(dir === '' && SKIP_DIRS.test(ent.name)) && ent.name.charAt(0) !== '.' && ent.name !== 'node_modules') walk(rel); }
      else if (ent.isFile() && /\.html?$/i.test(ent.name)) out.push(rel);
    });
  })('');
  return out.sort();
}

/* The page's text with every tag made from its file. Returns
   { text, changed: [{file, from, to}], missing: [file], untagged: [file] }. */
function stampText(text, pageRel, base) {
  base = base || ROOT;
  const dir = path.dirname(path.join(base, pageRel));
  const cache = {};
  const changed = [], missing = [], untagged = [];
  const out = text.replace(TAG_RX, (all, pre, file, tag) => {
    const abs = path.normalize(path.join(dir, decodeURI(file)));
    if (abs.indexOf(path.normalize(base) + path.sep) !== 0) return all;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) { missing.push(file); return all; }
    const want = cache[abs] || (cache[abs] = hashOf(abs));
    if (tag !== want) changed.push({ file, from: tag, to: want });
    return pre + file + '?v=' + want;
  });
  let m;
  LOCAL_ASSET_RX.lastIndex = 0;
  while ((m = LOCAL_ASSET_RX.exec(text))) {
    const file = m[1], query = m[2] || '';
    if (/^(?:\/|vendor\/)/.test(file) || /(?:^|[?&])v=/.test(query.slice(1))) continue;
    untagged.push(file);
  }
  return { text: out, changed, missing, untagged };
}

/* Stamp (or, with write=false, only check) every page under `base`. */
function stampAll(opts) {
  opts = opts || {};
  const base = opts.base || ROOT;
  const report = { pages: 0, tags: 0, changed: [], missing: [], untagged: [] };
  pages(base).forEach(rel => {
    const abs = path.join(base, rel);
    const text = fs.readFileSync(abs, 'utf8');
    const r = stampText(text, rel, base);
    const n = (text.match(TAG_RX) || []).length;
    if (!n && !r.untagged.length) return;
    report.pages++;
    report.tags += n;
    r.changed.forEach(c => report.changed.push(Object.assign({ page: rel }, c)));
    r.missing.forEach(f => report.missing.push({ page: rel, file: f }));
    r.untagged.forEach(f => report.untagged.push({ page: rel, file: f }));
    if (opts.write && r.text !== text) fs.writeFileSync(abs, r.text);
  });
  return report;
}

module.exports = { stampAll, stampText, pages, hashOf, TAG_RX, ROOT };

if (require.main === module) {
  const check = process.argv.includes('--check');
  const r = stampAll({ write: !check });
  if (check) {
    const bad = r.changed.length + r.untagged.length;
    if (r.changed.length) {
      console.error(r.changed.length + ' ?v= tag(s) do not match their file:');
      r.changed.slice(0, 40).forEach(c => console.error('  ' + c.page + ': ' + c.file + '?v=' + c.from + '  (should be ' + c.to + ')'));
      if (r.changed.length > 40) console.error('  ... and ' + (r.changed.length - 40) + ' more');
    }
    if (r.untagged.length) {
      console.error(r.untagged.length + ' shared script(s)/stylesheet(s) loaded with no ?v= tag (add ?v=1; the stamp sets it):');
      r.untagged.forEach(u => console.error('  ' + u.page + ': ' + u.file));
    }
    r.missing.forEach(m => console.error('  note: ' + m.page + ' names ' + m.file + '?v=, which does not exist'));
    if (bad) { console.error('\nRun:  npm run stamp   (npm run build:offline runs it too) and commit the result.'); process.exit(1); }
    console.log('Every ?v= tag matches its file (' + r.tags + ' tags in ' + r.pages + ' pages).');
  } else {
    const files = Array.from(new Set(r.changed.map(c => c.file)));
    console.log('Version tags: ' + r.changed.length + ' changed' + (files.length ? ' (' + files.join(', ') + ')' : '') + '; ' + r.tags + ' tags in ' + r.pages + ' pages.');
    r.missing.forEach(m => console.log('  note: ' + m.page + ' names ' + m.file + '?v=, which does not exist'));
    if (r.untagged.length) {
      console.log('  ' + r.untagged.length + ' shared script(s)/stylesheet(s) have no ?v= tag yet: ' + r.untagged.map(u => u.page + ' → ' + u.file).join(', '));
    }
  }
}
