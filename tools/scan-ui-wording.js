#!/usr/bin/env node
/* ============================================================================
   tools/scan-ui-wording.js — find wording that tells people WHERE the Centre's
   information is synced from or kept.

   THE RULE (the Centre's owner): the screens must never say where information
   is synced from or stored — "in no shape or form should this be indicated to
   users". People see what happened and what to do ("Sync Now", "Up to date",
   "Saved", "Could not sync — try again or ask the office"), never the place
   (no cloud, no Google / Drive / Gmail / Apps Script, no "the Centre's server",
   no LAN or Wi-Fi as a source, no "Offline System", no internet as the place
   data lives, no EmailJS / PeerJS / broker / MegaData, no IndexedDB /
   localStorage / "this browser's storage", and no ☁️ used as a sync sign).

   WHAT IT READS
   -------------
   Only what a person can actually see:
     - HTML pages and fragments: text, <title>, and the title / alt /
       aria-label / placeholder attributes (and value= on buttons);
     - the JavaScript in those pages and in the browser-side libraries: every
       string literal and every fixed part of a template literal, EXCEPT the
       ones a person never sees — console.* messages, comments, object keys,
       storage keys, element ids / class names / selectors, URLs and other
       single code-like tokens. HTML built inside a string is read the same way
       as a page (its class / id / data-* attributes are code, its text is not).

   Developer-only material is deliberately out of scope: docs, READMEs, the
   operator's "READ ME FIRST.txt", the migration command-line tools, the
   broker's server-side code, vendor libraries, tests.

   USE
   ---
     node tools/scan-ui-wording.js           list every hit; exit 1 if any
     node tools/scan-ui-wording.js --json    the same, as JSON

   tests/ui-no-sync-source-wording.test.js runs it as part of `npm test`.
   Zero dependencies — plain Node.
   ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ---------------------------------------------------------------- the words */
/* Each rule is matched against text a person sees. `re` must be global.
   `unless` (optional) is tested on the 24 characters before the hit. */
const RULES = [
  { id: 'cloud', re: /\bclouds?\b/gi },
  { id: 'cloud-emoji', re: /☁/g },
  { id: 'google', re: /\bgoogle\b/gi },
  { id: 'drive', re: /\bdrive\b/gi },
  { id: 'gmail', re: /\bgmail\b/gi },
  { id: 'apps-script', re: /\bapps?[\s-]*script\b/gi },
  // A video or relay server address is a technical value the administrator
  // types into Settings — the label may say so. Any other server may not.
  { id: 'server', re: /\bservers?\b/gi, unless: /\b(video|relay)\s+$/i },
  { id: 'lan', re: /\bLAN\b/g },
  { id: 'network', re: /\b(?:(?:centre|center|school|office|training centre)(?:['’]s)?\s+(?:own\s+)?(?:local\s+)?network|local\s+network|wi-?fi)\b/gi },
  { id: 'offline-system', re: /\boffline\s+system\b/gi },
  { id: 'internet', re: /\binternet\b/gi },
  { id: 'emailjs', re: /\bemail\s*js\b/gi },
  { id: 'peerjs', re: /\bpeer\s*js\b/gi },
  { id: 'broker', re: /\bbrokers?\b/gi },
  { id: 'megadata', re: /\bmega\s*data\b/gi },
  { id: 'indexeddb', re: /\bindexed\s*db\b/gi },
  { id: 'localstorage', re: /\blocal\s*storage\b/gi },
  { id: 'browser-storage', re: /\bbrowser(?:['’]s)?\s+storage\b/gi }
];

/* ------------------------------------------------------------ what to read */
const HTML_DIRS = ['', 'Pages'];
/* Browser-side libraries that build what people see. */
const JS_FILES_ROOT = /^[^/]+\.js$/;
const JS_DIRS = ['megadata', 'megadata/pages'];
/* Never read: command-line migration tools run by an operator (they print to
   a terminal, not a screen anyone signs in to) and vendor code. */
const SKIP = [
  /^megadata\/bootstrap-/, /^megadata\/drive-fetch\.js$/, /^megadata\/adapters\.js$/,
  /^megadata\/broker-appsscript\//, /^vendor\//
];

/* The small, explicit list of technical values that may stay. Prose is never
   allowed here: each entry names a file and the exact literal, and says why.
   (file, text) — the hit is excused only if the literal/visible text equals
   `text` exactly. */
const ALLOW = [];

/* ------------------------------------------------------------- utilities */
function lineStarts(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}
function lineAt(starts, offset) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
  return lo + 1;
}
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·', rarr: '→', larr: '←', times: '×', bull: '•', copy: '©' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch (x) { return m; }
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
  });
}
/* Undo the escapes inside a JS string literal well enough to read its words. */
function unescapeJs(s) {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (m, e) => {
    if (e[0] === 'u' && e.length > 1) {
      const hex = e[1] === '{' ? e.slice(2, -1) : e.slice(1);
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch (x) { return m; }
    }
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e === 'n' || e === 'r' || e === 't') return ' ';
    if (e === '\n' || e === '\r') return '';
    return e;
  });
}

/* Run every rule over one piece of visible text. */
function findWords(text) {
  const found = [];
  RULES.forEach(rule => {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text))) {
      if (rule.unless && rule.unless.test(text.slice(Math.max(0, m.index - 24), m.index))) continue;
      found.push({ rule: rule.id, word: m[0], index: m.index });
    }
  });
  return found;
}

/* ------------------------------------------------------------ JS reading */
const KEYWORDS_BEFORE_EXPR = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'do', 'else', 'yield', 'await']);

/* A tokenizer that knows just enough JavaScript to tell strings, template
   literals, regular expressions and comments apart. Returns tokens
   { t: 'str'|'tpl'|'id'|'p'|'num'|'re', v, start, end }; a template literal
   contributes a 'tpl' token per fixed part, and its ${…} code is tokenized in
   place. */
function tokenizeJs(src, base) {
  base = base || 0;
  const toks = [];
  let i = 0;
  const n = src.length;
  const braceStack = [];   // 'tpl' marks a ${ opened inside a template
  function lastSig() { return toks.length ? toks[toks.length - 1] : null; }
  function regexAllowed() {
    const p = lastSig();
    if (!p) return true;
    if (p.t === 'num' || p.t === 'str' || p.t === 'tpl' || p.t === 're') return false;
    if (p.t === 'id') return KEYWORDS_BEFORE_EXPR.has(p.v);
    if (p.t === 'p') return !(p.v === ')' || p.v === ']' || p.v === '}' || p.v === '++' || p.v === '--');
    return true;
  }
  function readTemplate(from) {
    // `from` is just after the opening back-tick (or after the } closing ${…}).
    let j = from, chunkStart = from;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') {
        toks.push({ t: 'tpl', v: src.slice(chunkStart, j), start: base + chunkStart, end: base + j });
        return j + 1;
      }
      if (c === '$' && src[j + 1] === '{') {
        toks.push({ t: 'tpl', v: src.slice(chunkStart, j), start: base + chunkStart, end: base + j, open: true });
        braceStack.push('tpl');
        return j + 2;
      }
      j++;
    }
    toks.push({ t: 'tpl', v: src.slice(chunkStart), start: base + chunkStart, end: base + n });
    return n;
  }
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿' || c === ' ' || c === ' ') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '<' && src.startsWith('<!--', i)) { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; else if (src[j] === '\n') break; j++; }
      toks.push({ t: 'str', v: src.slice(i + 1, j), start: base + i, end: base + j + 1 });
      i = j + 1; continue;
    }
    if (c === '`') { i = readTemplate(i + 1); continue; }
    if (c === '}' && braceStack.length && braceStack[braceStack.length - 1] === 'tpl') {
      braceStack.pop();
      i = readTemplate(i + 1); continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, inClass = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;
        if (inClass) { if (d === ']') inClass = false; }
        else if (d === '[') inClass = true;
        else if (d === '/') break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      toks.push({ t: 're', v: src.slice(i, j), start: base + i, end: base + j });
      i = j; continue;
    }
    if (/[A-Za-z_$À-￿]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$À-￿]/.test(src[j])) j++;
      toks.push({ t: 'id', v: src.slice(i, j), start: base + i, end: base + j });
      i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j])) j++;
      toks.push({ t: 'num', v: src.slice(i, j), start: base + i, end: base + j });
      i = j; continue;
    }
    // Punctuators: a few multi-character ones matter for context.
    const three = src.substr(i, 4);
    let p = c;
    for (const cand of ['===', '!==', '...', '=>', '==', '!=', '++', '--', '&&', '||', '??', '?.', '+=']) {
      if (three.startsWith(cand)) { p = cand; break; }
    }
    if (p === '{') braceStack.push('{');
    else if (p === '}') braceStack.pop();
    toks.push({ t: 'p', v: p, start: base + i, end: base + i + p.length });
    i += p.length;
  }
  return toks;
}

/* Calls whose string arguments are code, never shown. */
const CODE_CALLS = new Set([
  'getItem', 'setItem', 'removeItem', 'getElementById', 'querySelector', 'querySelectorAll',
  'getElementsByClassName', 'getElementsByTagName', 'closest', 'matches', 'add', 'remove', 'toggle',
  'contains', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'CustomEvent', 'Event',
  'fetch', 'importScripts', 'register', 'createElement', 'getAttribute', 'hasAttribute',
  'removeAttribute', 'open', 'require', 'postMessage', 'indexOf', 'includes', 'startsWith', 'endsWith',
  'split', 'replace', 'replaceAll', 'match', 'test', 'getCollection', 'saveCollection', 'guardedSet',
  'transaction', 'objectStore', 'createObjectStore', 'deleteDatabase', 'BroadcastChannel', 'RegExp'
]);
/* Assignment / call sinks that put a single word on screen. */
const DISPLAY_PROPS = new Set(['textContent', 'innerText', 'innerHTML', 'outerHTML', 'title', 'placeholder', 'alt', 'ariaLabel']);
const DISPLAY_CALLS = new Set(['showToast', 'toast', 'alert', 'confirm', 'prompt', 'notify', 'setStatus', 'showMessage', 'cestisAlert', 'cestisConfirm', 'cestisPrompt', 'styledAlert', 'styledConfirm', 'showBanner', 'setBanner']);

/* Is the 'str'/'tpl' token at index k inside the arguments of console.*(…)? */
function consoleRanges(toks) {
  const ranges = [];
  for (let k = 0; k + 3 < toks.length; k++) {
    if (toks[k].t === 'id' && toks[k].v === 'console' && toks[k + 1].v === '.' && toks[k + 2].t === 'id' && toks[k + 3].v === '(') {
      let depth = 0, m = k + 3;
      for (; m < toks.length; m++) {
        if (toks[m].v === '(' && toks[m].t === 'p') depth++;
        else if (toks[m].v === ')' && toks[m].t === 'p') { depth--; if (!depth) break; }
      }
      ranges.push([k + 3, m]);
    }
  }
  return ranges;
}
/* The name of the call whose argument list directly contains token k, if any. */
function enclosingCall(toks, k) {
  let depth = 0;
  for (let m = k - 1; m >= 0 && k - m < 400; m--) {
    const t = toks[m];
    if (t.t !== 'p') continue;
    if (t.v === ')' || t.v === ']' || t.v === '}') depth++;
    else if (t.v === '(' || t.v === '[' || t.v === '{') {
      if (depth) { depth--; continue; }
      if (t.v !== '(') return null;
      const prev = toks[m - 1];
      return prev && prev.t === 'id' ? prev.v : null;
    } else if (!depth && (t.v === ';')) return null;
  }
  return null;
}

/* Does a string look like one code token (a key, an id, a class, a URL…)? */
function codeLike(s) {
  if (/☁/.test(s)) return false;
  if (/^\s*$/.test(s)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s.trim())) return true;             // a URL
  if (!/\s/.test(s.trim())) return true;                                     // one token
  return false;
}

/* Strip the code out of HTML built in a string and keep what is visible. */
const VISIBLE_ATTRS = /\b(title|alt|aria-label|placeholder|data-tip|data-tooltip|label)\s*=\s*(\\?["'])(.*?)\2/gi;
function visibleFromMarkup(s) {
  if (!/<\/?[a-zA-Z!]|^[^<]*>|=\s*\\?["']/.test(s)) return s;
  const kept = [];
  s.replace(VISIBLE_ATTRS, (m, a, q, v) => { kept.push(v); return m; });
  let out = s;
  // A fixed part that begins inside a tag (…class="x">Text): drop up to the '>'.
  const firstGt = out.indexOf('>'), firstLt = out.indexOf('<');
  if (firstGt !== -1 && (firstLt === -1 || firstGt < firstLt)) out = out.slice(firstGt + 1);
  out = out.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ');
  // A fixed part that ends inside a tag (<span class="…): drop from the '<'.
  const lastLt = out.lastIndexOf('<');
  if (lastLt !== -1) out = out.slice(0, lastLt);
  return decodeEntities(out) + (kept.length ? ' ' + kept.join(' ') : '');
}

function scanJs(src, base, starts, file, hits) {
  let toks;
  try { toks = tokenizeJs(src, base); } catch (e) { hits.push({ file, line: lineAt(starts, base), rule: 'scanner', word: '', text: 'could not read this script: ' + e.message }); return; }
  const cons = consoleRanges(toks);
  const inConsole = k => cons.some(r => k > r[0] && k < r[1]);
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.t !== 'str' && tk.t !== 'tpl') continue;
    if (!tk.v) continue;
    if (inConsole(k)) continue;
    const prev = toks[k - 1], next = toks[k + 1];
    // An object key: { 'key': … } / , 'key': …
    if (tk.t === 'str' && next && next.v === ':' && prev && (prev.v === '{' || prev.v === ',')) continue;
    const raw = unescapeJs(tk.v);
    const call = enclosingCall(toks, k);
    let display = false;
    if (call && DISPLAY_CALLS.has(call)) display = true;
    if (prev && prev.v === '=' && toks[k - 2] && toks[k - 2].t === 'id' && DISPLAY_PROPS.has(toks[k - 2].v)) display = true;
    if (!display && call && CODE_CALLS.has(call) && codeLike(raw)) continue;
    if (prev && (prev.v === '===' || prev.v === '!==' || prev.v === '==' || prev.v === '!=') && codeLike(raw)) continue;
    if (next && (next.v === '===' || next.v === '!==' || next.v === '==' || next.v === '!=') && codeLike(raw)) continue;
    if (tk.t === 'tpl' && prev && prev.t === 'id' && !KEYWORDS_BEFORE_EXPR.has(prev.v) && k > 0 && src[tk.start - base - 1] === '`') {
      // tagged template (css`…`, html`…`) — treat like any other template.
    }
    let text = visibleFromMarkup(raw);
    if (!display && codeLike(text)) {
      // One bare token is code unless it is plainly a word on screen.
      const word = text.trim();
      if (!/^[☁]/.test(word) && !/^(Cloud|Google|Drive|Gmail|LAN|MegaData|EmailJS|PeerJS|Broker|IndexedDB|Server|Internet)[\s.:!?…]*$/.test(word)) continue;
    }
    // Inside a string of code-like tokens (a class list, a selector), the
    // pieces with - _ . # / around them are names, not words.
    const words = findWords(text).filter(w => {
      const idx = w.index;
      const before = text[idx - 1] || ' ', after = text[idx + w.word.length] || ' ';
      if (/[_#.$/@\\]/.test(before) || /[_$/\\]/.test(after)) return false;
      if (after === '.' && /\w/.test(text[idx + w.word.length + 1] || '')) return false;
      if ((before === '-' || after === '-') && !/[A-Z]/.test(w.word[0])) return false;
      return true;
    });
    if (!words.length) continue;
    const shown = text.replace(/\s+/g, ' ').trim();
    if (ALLOW.some(a => a.file === file && (a.text === shown || a.text === raw))) continue;
    words.forEach(w => hits.push({ file, line: lineAt(starts, tk.start), rule: w.rule, word: w.word, text: shown.slice(0, 200), start: tk.start, end: tk.end }));
  }
}

/* ---------------------------------------------------------- HTML reading */
function parseAttrs(tagSrc) {
  const attrs = [];
  const rx = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  const body = tagSrc.replace(/^<[^\s>/]+/, '');
  const off = tagSrc.length - body.length;
  while ((m = rx.exec(body))) {
    if (m[0] === '/') continue;
    const val = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
    const valOff = m[2] !== undefined || m[3] !== undefined ? m.index + m[0].indexOf(val, m[1].length) : m.index;
    attrs.push({ name: m[1].toLowerCase(), value: val, at: off + Math.max(0, valOff) });
  }
  return attrs;
}

function scanHtml(src, file) {
  const hits = [];
  const starts = lineStarts(src);
  const report = (offset, text) => {
    const shown = decodeEntities(text).replace(/\s+/g, ' ').trim();
    if (!shown) return;
    if (ALLOW.some(a => a.file === file && a.text === shown)) return;
    findWords(shown).forEach(w => hits.push({ file, line: lineAt(starts, offset), rule: w.rule, word: w.word, text: shown.slice(0, 200), start: offset, end: offset + text.length }));
  };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) report(i, src.slice(i, textEnd));
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    // Find the end of the tag, respecting quoted attribute values.
    let j = lt + 1, q = null;
    while (j < n) {
      const c = src[j];
      if (q) { if (c === q) q = null; }
      else if (c === '"' || c === "'") q = c;
      else if (c === '>') break;
      j++;
    }
    const tagSrc = src.slice(lt, j + 1);
    const nameM = /^<\/?([a-zA-Z][\w-]*)/.exec(tagSrc);
    if (!nameM) { report(lt, '<'); i = lt + 1; continue; }
    const name = nameM[1].toLowerCase();
    i = j + 1;
    if (tagSrc[1] === '/') continue;
    const attrs = parseAttrs(tagSrc);
    const get = a => { const f = attrs.find(x => x.name === a); return f ? f.value : null; };
    attrs.forEach(a => {
      if (a.value == null) return;
      if (/^(title|alt|aria-label|placeholder|label|data-tip|data-tooltip)$/.test(a.name)) report(lt + a.at, a.value);
      else if (a.name === 'value' && (name === 'button' || (name === 'input' && /^(button|submit|reset)$/i.test(get('type') || '')))) report(lt + a.at, a.value);
      else if (/^on[a-z]+$/.test(a.name)) scanJs(decodeEntities(a.value), lt + a.at, starts, file, hits);
    });
    if (name === 'script') {
      const close = src.toLowerCase().indexOf('</script', i);
      const end = close < 0 ? n : close;
      const type = (get('type') || '').toLowerCase();
      if (!get('src') && (!type || /javascript|module|ecmascript/.test(type))) scanJs(src.slice(i, end), i, starts, file, hits);
      else if (/html|template/.test(type)) scanHtml(src.slice(i, end), file).forEach(h => hits.push(Object.assign(h, { line: h.line + lineAt(starts, i) - 1 })));
      const gt = close < 0 ? n : src.indexOf('>', close);
      i = gt < 0 ? n : gt + 1;
    } else if (name === 'style') {
      const close = src.toLowerCase().indexOf('</style', i);
      const gt = close < 0 ? n : src.indexOf('>', close);
      i = gt < 0 ? n : gt + 1;
    }
  }
  return hits;
}

function scanJsFile(src, file) {
  const hits = [];
  scanJs(src, 0, lineStarts(src), file, hits);
  return hits;
}

/* ------------------------------------------------------------- the repo */
function listFiles(root) {
  root = root || ROOT;
  const files = [];
  HTML_DIRS.forEach(d => {
    const dir = path.join(root, d);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    names.filter(f => f.endsWith('.html')).sort().forEach(f => files.push(d ? d + '/' + f : f));
  });
  fs.readdirSync(root).filter(f => JS_FILES_ROOT.test(f)).sort().forEach(f => files.push(f));
  JS_DIRS.forEach(d => {
    let names = [];
    try { names = fs.readdirSync(path.join(root, d)); } catch (e) { return; }
    names.filter(f => f.endsWith('.js')).sort().forEach(f => files.push(d + '/' + f));
  });
  return files.filter(f => !SKIP.some(rx => rx.test(f)));
}

function scanFile(rel, src) {
  return rel.endsWith('.html') ? scanHtml(src, rel) : scanJsFile(src, rel);
}

function scanRepo(root) {
  root = root || ROOT;
  const all = [];
  listFiles(root).forEach(rel => {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    scanFile(rel, src).forEach(h => all.push(h));
  });
  all.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line);
  return all;
}

module.exports = { RULES, ALLOW, findWords, tokenizeJs, scanHtml, scanJsFile, scanFile, scanRepo, listFiles };

if (require.main === module) {
  const hits = scanRepo(ROOT);
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(hits, null, 1) + '\n');
  } else {
    let last = '';
    hits.forEach(h => {
      if (h.file !== last) { console.log('\n' + h.file); last = h.file; }
      console.log('  ' + h.line + '  [' + h.rule + '] ' + h.text);
    });
    console.log('\n' + hits.length + ' place(s) on screen say where information is synced from or kept.');
  }
  process.exitCode = hits.length ? 1 : 0;
}
