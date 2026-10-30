#!/usr/bin/env node
/* ============================================================================
   tools/build-offline.js — regenerate "Offline System/" from the main build.

   WHY THIS EXISTS
   ---------------
   "Offline System/" is the whole platform for a Centre running on its own
   network with no internet. It used to be a hand-maintained second copy of
   every page, and it drifted: fixes made to the main build never reached it.
   By the time anyone compared them, its dashboard was ~250 changes behind and
   called a function (saveCollection) its copy no longer defined — so on the
   offline build NOTHING the dashboard saved was ever kept, and the Reports
   page threw on every admin sign-in.

   Now the offline folder is GENERATED. Every shared file is copied from the
   main build byte for byte. The only files that belong to the offline build
   alone are the ones that have no equivalent online (its server, launchers
   and READMEs — OFFLINE_OWNED below), and those are never touched here.
   Everything the offline build needs from the shared pages (finding the
   Centre's server, video through it, the dashboard's shared store) is carried
   by the main build itself and switches on only when that server answers, so
   there is nothing to patch: ADAPTATIONS is empty, and REQUIRED_HOOKS makes
   sure nobody removes those switches from the main build without noticing.

   USE
   ---
     node tools/build-offline.js            stamp every page's ?v= tags from its
                                            files (tools/stamp-versions.js), then
                                            rewrite "Offline System/" in place
     node tools/build-offline.js --check    change nothing; exit 1 and list the
                                            differences if it is out of date, or
                                            if a ?v= tag does not match its file
     node tools/build-offline.js --out DIR  write a complete offline folder to DIR

   tests/offline-build.test.js runs --check as part of `npm test`, so a change
   to a shared page that is not regenerated fails the build.

   Zero dependencies — plain Node, like everything else in the offline build.
   ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OFFLINE_DIR_NAME = 'Offline System';

/* Main-build files that are NOT part of the offline build (paths relative to
   the repository root, '/'-separated). */
const EXCLUDE = [
  /^Offline System\//,                     // the output itself
  /^tests\//, /^docs\//, /^tools\//,       // development only
  /^node_modules\//,
  /^cert\//,                               // a machine's own certificate, never shipped
  // MegaData's migration tooling: run once by an operator with internet, from
  // the main build. The browser-side MegaData files DO ship — the MegaData
  // admin pages load them, and the everyday pages' megadata/loader.js fetches
  // them only on a device where a broker has been set up (none is, today).
  /^megadata\/broker-appsscript\//, /^megadata\/(bootstrap-|drive-fetch|adapters\.js)/,
  /^megadata-bootstrap-staging\//, /^megadata-sources\//, /^megadata-broker-url\.txt$/,
  /^[0-9]-[A-Z0-9-]+\.bat$/,               // the MegaData migration scripts
  /^MEGADATA_SPEC\.md$/, /^PRODUCTIVITY-AUDIT\.md$/, /^README\.md$/,
  /^package(-lock)?\.json$/,               // the offline build has its own
  // The payroll rates are edited on GitHub by the owner (a five-step recipe);
  // copying them here would make every such edit fail the drift check. With
  // no internet the Payroll page's "Fetch Current Rates" could not reach the
  // other sources either: rates are typed in Settings, as before.
  /^payroll-rates\.json$/,
  // Real per-user exports are never copied anywhere; only the documented
  // structure ships.
  /^User Login\/(?!README\.md$|_TEMPLATE\/)/
];

/* Files that exist only in the offline build. The generator never writes,
   compares or deletes these — they are maintained in "Offline System/". */
const OFFLINE_OWNED = [
  /^cestis-offline-(server|signalling|cert|store|gate)\.js$/,
  /^START-(WINDOWS\.bat|MAC\.command|LINUX\.sh)$/,
  /^READ ME FIRST\.txt$/,
  /^data\/READ ME - THIS IS THE CENTRE'S DATA\.txt$/,
  /^package\.json$/, /^\.gitignore$/,
  /^tests\//                                // the offline server's own tests
];

/* What a running Centre keeps in the folder: its records, its certificate,
   real user exports. Never compared, never copied, never deleted. */
const LOCAL_STATE = [
  /^data\/(?!READ ME - THIS IS THE CENTRE'S DATA\.txt$)/,
  /^cert\//, /^node_modules\//,
  /^User Login\/(?!README\.md$|_TEMPLATE\/)/,
  /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/, /(^|\/)desktop\.ini$/
];

/* Changes applied to a shared file on its way into the offline build: each
   { file, anchor, insert, where: 'after'|'before' }, and the anchor must occur
   EXACTLY once or the build stops. Empty, deliberately — see REQUIRED_HOOKS. */
const ADAPTATIONS = [];

/* What the offline build relies on the main build carrying. Each string must
   occur in that file, or the build stops: removing one would quietly turn the
   offline build back into a copy of the online one with no shared store. */
const REQUIRED_HOOKS = [
  { file: 'cestis-page-cloud.js', needles: ["'/_cestis/health'", 'initLan:', "'CESTIS_ALL_DATA.json'"] },
  { file: 'index.html', needles: ['<script src="cestis-offline-rtc.js', 'CESTISPageCloud.initLan({', "file: 'CESTIS_LMS_Dashboard.json'"] },
  { file: 'cestis-offline-rtc.js', needles: ['/peerjs'] }
];

const matches = (list, rel) => list.some(rx => rx.test(rel));

function walk(base, dir, acc) {
  let entries;
  try { entries = fs.readdirSync(path.join(base, dir), { withFileTypes: true }); } catch (e) { return acc; }
  entries.forEach(ent => {
    const rel = dir ? dir + '/' + ent.name : ent.name;
    if (ent.isDirectory()) {
      // Dot-folders (.git, .github, .claude) are tooling, never pages.
      if (ent.name.charAt(0) === '.') return;
      walk(base, rel, acc);
    } else if (ent.isFile()) {
      acc.push(rel);
    }
  });
  return acc;
}

/* The shared files, and their bytes as the offline build carries them. */
function plan() {
  REQUIRED_HOOKS.forEach(h => {
    const src = fs.readFileSync(path.join(ROOT, h.file), 'utf8');
    h.needles.forEach(n => {
      if (src.indexOf(n) === -1) {
        throw new Error('build-offline: ' + h.file + ' no longer contains ' + JSON.stringify(n) +
          ' — the offline build depends on it (see REQUIRED_HOOKS in tools/build-offline.js).');
      }
    });
  });
  const files = walk(ROOT, '', [])
    .filter(rel => rel.indexOf('/') !== -1 || rel.charAt(0) !== '.')   // root dot-files (.gitignore…)
    .filter(rel => !matches(EXCLUDE, rel))
    .filter(rel => !matches(OFFLINE_OWNED, rel) && !matches(LOCAL_STATE, rel))
    .sort();
  const out = new Map();
  files.forEach(rel => out.set(rel, fs.readFileSync(path.join(ROOT, rel))));
  ADAPTATIONS.forEach(a => {
    const buf = out.get(a.file);
    if (!buf) throw new Error('build-offline: adaptation for missing file ' + a.file);
    const src = buf.toString('utf8');
    const i = src.indexOf(a.anchor);
    if (i === -1 || src.indexOf(a.anchor, i + 1) !== -1) {
      throw new Error('build-offline: the anchor for ' + a.file + ' must occur exactly once: ' + JSON.stringify(a.anchor.slice(0, 80)));
    }
    const at = a.where === 'before' ? i : i + a.anchor.length;
    out.set(a.file, Buffer.from(src.slice(0, at) + a.insert + src.slice(at), 'utf8'));
  });
  return out;
}

/* Files in an offline folder that the generator is responsible for. */
function generatedIn(dir) {
  return walk(dir, '', []).filter(rel => !matches(OFFLINE_OWNED, rel) && !matches(LOCAL_STATE, rel)).sort();
}

/* Compare a plan with an offline folder. Returns a list of differences. */
function diff(planned, dir) {
  const problems = [];
  const have = new Set(generatedIn(dir));
  planned.forEach((buf, rel) => {
    if (!have.has(rel)) { problems.push('missing:  ' + rel); return; }
    if (!buf.equals(fs.readFileSync(path.join(dir, rel)))) problems.push('differs:  ' + rel);
  });
  have.forEach(rel => { if (!planned.has(rel)) problems.push('stale:    ' + rel); });
  return problems;
}

/* Write the plan into an offline folder; remove generated files that the main
   build no longer has. Owned files and the Centre's own data are never touched. */
function write(planned, dir, log) {
  const say = log || function () {};
  let wrote = 0, removed = 0;
  planned.forEach((buf, rel) => {
    const dst = path.join(dir, rel);
    let same = false;
    try { same = buf.equals(fs.readFileSync(dst)); } catch (e) {}
    if (same) return;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, buf);
    wrote++;
    say('  wrote    ' + rel);
  });
  generatedIn(dir).forEach(rel => {
    if (planned.has(rel)) return;
    fs.unlinkSync(path.join(dir, rel));
    removed++;
    say('  removed  ' + rel);
  });
  return { wrote, removed };
}

/* A complete offline folder at `out`: the generated files plus the offline
   build's own. */
function buildTo(out) {
  const planned = plan();
  const off = path.join(ROOT, OFFLINE_DIR_NAME);
  fs.mkdirSync(out, { recursive: true });
  write(planned, out);
  walk(off, '', []).filter(rel => matches(OFFLINE_OWNED, rel) && !matches(LOCAL_STATE, rel)).forEach(rel => {
    const dst = path.join(out, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(off, rel), dst);
    try { fs.chmodSync(dst, fs.statSync(path.join(off, rel)).mode); } catch (e) {}
  });
  return planned;
}

/* --check: generate into a scratch folder and compare with the committed one. */
function check() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-offline-'));
  try {
    const planned = buildTo(tmp);
    // The scratch build itself must be exactly the plan (proves write()), and
    // the committed folder must match it byte for byte.
    const selfCheck = diff(planned, tmp);
    if (selfCheck.length) return ['the generator could not reproduce its own output:'].concat(selfCheck);
    return diff(planned, path.join(ROOT, OFFLINE_DIR_NAME));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
}

module.exports = { plan, diff, write, buildTo, check, EXCLUDE, OFFLINE_OWNED, LOCAL_STATE, ADAPTATIONS, REQUIRED_HOOKS, ROOT };

if (require.main === module) {
  const args = process.argv.slice(2);
  const stamp = require('./stamp-versions.js');
  try {
    if (args[0] === '--check') {
      const problems = check();
      const tags = stamp.stampAll({ write: false });
      tags.changed.forEach(c => problems.push('tag:      ' + c.page + ': ' + c.file + '?v=' + c.from + ' (its file says ' + c.to + ')'));
      tags.untagged.forEach(u => problems.push('no tag:   ' + u.page + ': ' + u.file));
      if (problems.length) {
        console.error('"Offline System/" or a version tag is out of date with the main build (' + problems.length + ' item(s)):');
        problems.slice(0, 40).forEach(p => console.error('  ' + p));
        if (problems.length > 40) console.error('  ... and ' + (problems.length - 40) + ' more');
        console.error('\nRun:  node tools/build-offline.js   (or npm run build:offline) and commit the result.');
        process.exit(1);
      }
      console.log('"Offline System/" matches the main build, and every ?v= tag matches its file (' + tags.tags + ' tags).');
    } else if (args[0] === '--out') {
      if (!args[1]) throw new Error('--out needs a folder');
      const planned = buildTo(path.resolve(args[1]));
      console.log('Wrote a complete offline folder (' + planned.size + ' shared files) to ' + path.resolve(args[1]));
    } else {
      // The pages' ?v= tags first, so the offline copies carry the right ones.
      const tags = stamp.stampAll({ write: true });
      const changedFiles = Array.from(new Set(tags.changed.map(c => c.file)));
      console.log('Version tags: ' + tags.changed.length + ' changed' + (changedFiles.length ? ' (' + changedFiles.join(', ') + ')' : '') + '.');
      const r = write(plan(), path.join(ROOT, OFFLINE_DIR_NAME), msg => console.log(msg));
      console.log('"Offline System/" regenerated: ' + r.wrote + ' file(s) written, ' + r.removed + ' removed.');
    }
  } catch (e) {
    console.error(e && e.message || e);
    process.exit(1);
  }
}
