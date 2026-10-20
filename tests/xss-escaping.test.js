/* What a person types is shown as text, never run as code.

   The Administrator's browser holds the Centre's Google Drive token, so any
   script that runs there can read or destroy every record. Script got there
   from text other people type: a trainee's self-chosen name, an instructor's
   announcement or exam question, a chat message, an attachment's file name,
   a resource link, a video-class title, the public Support form (no account
   needed), a notification pushed over the realtime channel, and the
   certificate QR link itself. Verified in a real browser, each of these ran
   in the admin session:
     - the notification bell, Support Messages, attendance registers, GPA
       leaderboards, certificate pages, exam lists and question views,
       assignments, resources and video-class lists printed those fields raw;
     - the chat linkifier wrapped a URL that may contain a quote in
       href="...", so a message ran on sight; file names went into
       onclick="f('...')" where an apostrophe ends the string;
     - several buttons "escaped" an apostrophe as &#39; or \' inside an
       inline onclick — the browser decodes the attribute BEFORE the
       JavaScript runs, so the quote came straight back (it also broke the
       buttons for anyone called O'Connor);
     - resource "links" could be javascript: URLs.

   What these tests pin:
     1. CESTISCore.html — the one escaping toolkit — escapes quotes and
        backticks, builds handler arguments that survive attribute decoding,
        refuses script links however they are disguised, linkifies safely and
        rebuilds a notification from another device out of known fields only.
     2. The page helpers (escapeHtml, escapeAttr, _certEsc, lmsChatEscapeHtml,
        jsArg, safeUrl) hand their work to it, and still work if a stale
        cached core lacks it.
     3. The real render functions, extracted from index.html and run against
        records whose every field is an attack, produce markup in which no
        tag or attribute was injected, every inline handler still parses and
        calls only what it meant to with exactly the original value, and no
        link is a script link.
     4. The staff-appraisal roster buttons work for "Dwayne O'Connor".
     5. A cheap static guard over the fixed renderers: no raw user field is
        concatenated into their markup again.

   Run: node tests/xss-escaping.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const Core = require('../cestis-core.js');
const H = Core.html;
const SRC = read('index.html');

function extractFunction(src, name, where) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name.replace(/\$/g, '\\$') + '\\s*\\(').exec(src);
  if (!m) throw new Error((where || 'index.html') + ' no longer defines ' + name + '()');
  const start = m.index;
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

/* ---------- a tiny HTML tokenizer: what tags and attributes a browser sees ---------- */
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', bull: '•', mdash: '—' };
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return Object.prototype.hasOwnProperty.call(NAMED, e.toLowerCase()) ? NAMED[e.toLowerCase()] : all;
  });
}
function parseTags(html) {
  const tags = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (!/[a-zA-Z]/.test(html[lt + 1] || '')) { i = lt + 1; continue; }
    let j = lt + 1;
    let name = '';
    while (j < html.length && !/[\s/>]/.test(html[j])) name += html[j++];
    const attrs = [];
    while (j < html.length && html[j] !== '>') {
      if (/[\s/]/.test(html[j])) { j++; continue; }
      let an = '';
      while (j < html.length && !/[\s/>=]/.test(html[j])) an += html[j++];
      if (!an) { an = html[j++]; }
      let val = '';
      while (/\s/.test(html[j] || '')) j++;
      if (html[j] === '=') {
        j++;
        while (/\s/.test(html[j] || '')) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, j + 1);
          val = html.slice(j + 1, end < 0 ? html.length : end);
          j = end < 0 ? html.length : end + 1;
        } else {
          while (j < html.length && !/[\s>]/.test(html[j])) val += html[j++];
        }
      }
      attrs.push({ name: an.toLowerCase(), value: decodeEntities(val) });
    }
    tags.push({ name: name.toLowerCase(), attrs });
    i = j + 1;
  }
  return tags;
}

/* ---------- run an inline handler with everything it touches recorded ---------- */
function runHandler(code) {
  const calls = [];
  let pwned = false;
  function recorder(label) {
    const fn = function () { calls.push({ name: label, args: Array.prototype.slice.call(arguments) }); return rec; };
    const rec = new Proxy(fn, {
      get(t, k) {
        if (k === Symbol.toPrimitive) return () => '';
        if (typeof k === 'symbol') return undefined;
        return recorder(label + '.' + k);
      },
      apply(t, self, args) { return t.apply(self, args); }
    });
    return rec;
  }
  const scope = new Proxy({}, {
    has: () => true,
    get(t, k) {
      if (k === Symbol.unscopables) return undefined;
      if (k === '__pwn') return () => { pwned = true; };
      if (k === 'event') return { stopPropagation() {}, preventDefault() {}, key: 'Enter' };
      if (k === 'undefined') return undefined;
      if (k === 'JSON' || k === 'String' || k === 'Number' || k === 'Math') return globalThis[k];
      return recorder(String(k));
    },
    set() { return true; }
  });
  let threw = null;
  try {
    // eslint-disable-next-line no-new-func
    const f = new Function('__scope', 'with (__scope) {\n' + code + '\n}');
    f.call(recorder('this'), scope);
  } catch (e) { threw = e; }
  return { calls, pwned, threw };
}

const ATTACK = {
  tag: '<img src=x onerror=__pwn(1)>',
  js: "'); __pwn(2);//",
  svg: '"><svg onload=__pwn(3)>',
  bs: "\\'); __pwn(4);//",
  ent: '&quot;); __pwn(5);//',
  attr: '"onmouseover="__pwn(6)',
  tick: '`;__pwn(7);//',
  apos: "Dwayne O'Connor"
};
const EVIL = ATTACK.tag + ATTACK.js + ATTACK.svg + ATTACK.ent + ATTACK.attr + ATTACK.tick + ' ' + ATTACK.apos;
const EVIL_URL = 'javascript:__pwn(8)//' + ATTACK.js;

/* Check markup the way a browser would see it. `fnSrc` lists the handlers the
   function legitimately writes; anything else is an injected attribute. */
function assertSafeMarkup(html, label, fnSrc) {
  const tags = parseTags(html);
  const legitOn = new Set((String(fnSrc || '').match(/\bon[a-z]+(?==)/g) || []));
  let ok = true;
  tags.forEach(t => {
    if (t.name === 'svg' || t.name === 'script' || t.name === 'iframe' || (t.name === 'img' && t.attrs.some(a => a.name === 'src' && a.value === 'x'))) {
      ok = false; console.error('    injected <' + t.name + '> in ' + label);
    }
    t.attrs.forEach(a => {
      if (/^on/.test(a.name)) {
        if (!legitOn.has(a.name)) { ok = false; console.error('    injected ' + a.name + '= in ' + label); return; }
        const r = runHandler(a.value);
        if (r.threw instanceof SyntaxError) { ok = false; console.error('    handler no longer parses in ' + label + ': ' + a.value.slice(0, 120)); }
        if (r.pwned) { ok = false; console.error('    handler ran injected code in ' + label + ': ' + a.value.slice(0, 120)); }
      }
      if ((a.name === 'href' || a.name === 'src') && /^\s*javascript:/i.test(a.value.replace(/[\t\n\r]/g, ''))) {
        ok = false; console.error('    script link in ' + label + ': ' + a.value.slice(0, 80));
      }
      if (a.name === 'style' && /animation|expression\(|url\(\s*['"]?javascript/i.test(a.value)) {
        ok = false; console.error('    injected style in ' + label);
      }
    });
  });
  assert(ok, label + ': no tag, attribute, handler or script link was injected');
  return tags;
}

/* All handler calls in some markup, run through the recorder. */
function handlerCalls(html) {
  const out = [];
  parseTags(html).forEach(t => t.attrs.forEach(a => {
    if (/^on/.test(a.name)) runHandler(a.value).calls.forEach(c => out.push(c));
  }));
  return out;
}

/* =====================================================================
   1. The shared toolkit
   ===================================================================== */
console.log('CESTISCore.html escapes every character that can end text or an attribute');

assertEq(H.esc('<a href="x" title=\'y\'>`&'), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&#96;&amp;', 'esc encodes < > " \' ` and &');
assertEq(H.esc(null), '', 'esc of nothing is empty');
assertEq(H.esc(45), '45', 'esc of a number is its digits');
assertEq(H.esc('</script><script>__pwn()</script>'), '&lt;/script&gt;&lt;script&gt;__pwn()&lt;/script&gt;', 'a closing </script> cannot end a block');
assertEq(H.attr, H.esc, 'attribute escaping is the same function (quotes always encoded)');
assertEq(H.esc('Plain name — no change'), 'Plain name — no change', 'ordinary text is untouched, so pages look the same');

console.log('CESTISCore.html.jsArg gives a handler argument that decodes to exactly the value');
[ATTACK.js, ATTACK.bs, ATTACK.ent, ATTACK.attr, ATTACK.tick, ATTACK.apos, '</script><img src=x>', 'line break ', 'back\\slash', '', 'STU-0001'].forEach(v => {
  const attrValue = H.jsArg(v);
  assert(attrValue.indexOf('"') === -1 && attrValue.indexOf("'") === -1 && attrValue.indexOf('<') === -1,
    'jsArg(' + JSON.stringify(v).slice(0, 30) + ') has no raw quote or < to end the attribute');
  const html = '<button onclick="go(' + attrValue + ')">x</button>';
  const r = runHandler(parseTags(html)[0].attrs[0].value);
  assert(!r.threw && !r.pwned, 'jsArg(' + JSON.stringify(v).slice(0, 30) + ') parses and runs nothing extra');
  assert(r.calls.length === 1 && r.calls[0].name === 'go' && r.calls[0].args[0] === v,
    'jsArg(' + JSON.stringify(v).slice(0, 30) + ') reaches the handler as exactly the original text');
});
assertEq(H.jsArg(null), '&quot;&quot;', 'jsArg of nothing is an empty string literal');

console.log('CESTISCore.html.safeUrl refuses a script link however it is disguised');
[
  'https://drive.google.com/file/d/abc/view', 'http://example.org/a?b=1&c=2', 'mailto:office@example.org',
  'tel:+18765550000', 'Pages/Help.html', '/docs/x.pdf', '#top', '?certificate=WE-2026-0001',
  'blob:https://example.org/1234', 'data:image/png;base64,iVBORw0KGgo=', 'data:image/svg+xml;base64,PHN2Zz4=',
  '//cdn.example.org/a.mp4'
].forEach(u => assertEq(H.safeUrl(u), u.trim(), 'safeUrl keeps ' + u));
[
  'javascript:__pwn(1)', 'JaVaScRiPt:__pwn(1)', '  javascript:__pwn(1)', '\u0001javascript:__pwn(1)',
  'java\tscript:__pwn(1)', 'java\nscript:__pwn(1)', 'jav\r\nascript:__pwn(1)', ' \n\tJAVASCRIPT:__pwn(1)',
  'vbscript:msgbox(1)', 'data:text/html,<script>__pwn()</script>', 'data:text/html;base64,PHNjcmlwdD4=',
  'livescript:x', '', null, undefined
].forEach(u => assertEq(H.safeUrl(u), '', 'safeUrl refuses ' + JSON.stringify(u)));
assertEq(H.safeUrl('data:application/pdf;base64,JVBERi0=', { data: true }), 'data:application/pdf;base64,JVBERi0=',
  'an inline file download (data:) is allowed only when asked for');
assertEq(H.safeUrl('javascript:__pwn()', { data: true }), '', 'and asking for data: never lets javascript: through');
assertEq(H.safeUrl('java&#115;cript:__pwn()'), 'java&#115;cript:__pwn()',
  'an entity-spelled scheme is a relative link once escaped (the browser never decodes it, because it is escaped)');

console.log('CESTISCore.html.linkify keeps a link a link');
{
  const msg = 'see https://x.co/"style="animation-name:spin;animation-duration:1s"onanimationstart="__pwn(1)"x and ' + ATTACK.tag;
  const html = H.linkify(msg, { style: 'color:var(--accent);text-decoration:underline;' });
  const tags = assertSafeMarkup(html, 'linkify', '');
  const a = tags.filter(t => t.name === 'a');
  assertEq(a.length, 1, 'one link');
  assertEq(a[0].attrs.map(x => x.name).join(','), 'href,target,rel,style', 'the link carries only the attributes it was built with');
  assertEq(a[0].attrs[0].value, 'https://x.co/', 'its address stops at the quote');
  assert(html.indexOf('&lt;img src=x onerror=__pwn(1)&gt;') !== -1, 'the rest of the message is shown as text');
  assertEq(H.linkify('plain words'), 'plain words', 'a message with no link is just escaped text');
  assert(/rel="noopener noreferrer"/.test(H.linkify('https://a.b')), 'links open without handing over window.opener');
}

console.log('CESTISCore.html notification helpers');
assertEq(H.escKeepCharRefs('&#128222; ' + ATTACK.tag), '&#128222; &lt;img src=x onerror=__pwn(1)&gt;',
  'a stored &#128222; still shows its emoji, markup does not');
assertEq(H.notifIcon('✉️'), '✉️', 'an emoji icon is kept');
assertEq(H.notifIcon('&#128249;'), '&#128249;', 'an emoji written as a character reference is kept');
assertEq(H.notifIcon(ATTACK.tag), '🔔', 'a markup "icon" becomes the bell');
assertEq(H.notifIcon('abc'), '🔔', 'letters are not an icon');
{
  const n = H.cleanNotification({ id: 'N1', text: 'x'.repeat(900), type: 'evil', icon: ATTACK.tag, forRoles: ['admin', '<b>', 7], forUsers: ['USR-1'], extra: 'dropped', read: true, time: ATTACK.tag });
  assertEq(n.text.length, 500, 'text is capped');
  assertEq(n.type, 'info', 'an unknown type becomes info');
  assertEq(n.icon, '🔔', 'a markup icon is replaced');
  assertEq(JSON.stringify(n.forRoles), '["admin"]', 'only real roles are kept');
  assertEq(JSON.stringify(n.forUsers), '["USR-1"]', 'user targets are kept as strings');
  assert(!('extra' in n), 'unknown fields are dropped');
  assertEq(n.read, false, 'it arrives unread');
  assertEq(n.time, 'Just now', 'with a fresh time label');
  assertEq(H.cleanNotification(null), null, 'junk is refused');
  assertEq(H.cleanNotification({ text: 'no id' }), null, 'a notification needs an id');
}

/* =====================================================================
   2. Page helpers hand their work to the toolkit
   ===================================================================== */
console.log('The page escapers delegate to the shared toolkit, with a fallback');
const HELPERS = ['escapeHtml', 'escapeAttr', 'jsArg', 'safeUrl', 'annPriorityClass', '_certEsc', 'lmsChatEscapeHtml', 'lmsChatLinkify'];
const helperSrc = HELPERS.map(n => extractFunction(SRC, n)).join('\n');
assert(/CESTISCore\.html\.esc\(s\)/.test(extractFunction(SRC, 'escapeHtml')), 'escapeHtml uses CESTISCore.html.esc');
assert(/return escapeHtml\(s\)/.test(extractFunction(SRC, 'escapeAttr')), 'escapeAttr is escapeHtml (it used to leave \' alone)');
assert(/return escapeHtml\(s\)/.test(extractFunction(SRC, '_certEsc')), '_certEsc is escapeHtml');
assert(/return escapeHtml\(str\)/.test(extractFunction(SRC, 'lmsChatEscapeHtml')), 'lmsChatEscapeHtml is escapeHtml (it left quotes alone)');
[true, false].forEach(withCore => {
  const sb = withCore ? { CESTISCore: Core } : {};
  vm.createContext(sb);
  vm.runInContext(helperSrc, sb);
  const tag = withCore ? 'with the core' : 'with a stale core';
  assertEq(vm.runInContext('escapeHtml(' + JSON.stringify(ATTACK.svg) + ')', sb), '&quot;&gt;&lt;svg onload=__pwn(3)&gt;', 'escapeHtml ' + tag);
  assertEq(vm.runInContext('escapeAttr("it\'s")', sb), 'it&#39;s', 'escapeAttr encodes an apostrophe ' + tag);
  const j = vm.runInContext('jsArg(' + JSON.stringify(ATTACK.js) + ')', sb);
  const r = runHandler(decodeEntities('go(' + j + ')'));
  assert(!r.pwned && r.calls[0] && r.calls[0].args[0] === ATTACK.js, 'jsArg round-trips ' + tag);
  assertEq(vm.runInContext('safeUrl(" javascript:__pwn()")', sb), '', 'safeUrl refuses javascript: ' + tag);
  assertEq(vm.runInContext('safeUrl("https://a.b/c")', sb), 'https://a.b/c', 'safeUrl keeps a web link ' + tag);
  assertEq(vm.runInContext('annPriorityClass("urgent\\" onmouseover=\\"x")', sb), 'general', 'a priority cannot become a class-name breakout');
  const lk = vm.runInContext('lmsChatLinkify(' + JSON.stringify('https://x.co/"onmouseover="__pwn()"') + ')', sb);
  assertSafeMarkup(lk, 'lmsChatLinkify ' + tag, '');
});

/* =====================================================================
   3. The real renderers, fed records whose every field is an attack
   ===================================================================== */

function makeEl(id) {
  const el = {
    id: id || '', innerHTML: '', textContent: '', value: '', className: '', checked: false,
    style: {}, dataset: {}, scrollTop: 0, scrollHeight: 0, clientHeight: 0, children: [],
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle() {} },
    appendChild(c) { this.children.push(c); return c; }, insertBefore() {}, removeChild() {}, remove() {},
    setAttribute() {}, getAttribute() { return null; }, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, contains() { return false; },
    focus() {}, click() {}, scrollIntoView() {}
  };
  el.parentNode = el; el.parentElement = el;
  return el;
}
function makeSandbox(extra) {
  const els = {};
  const doc = {
    getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
    querySelector(sel) { const k = 'q:' + sel; if (!els[k]) els[k] = makeEl(k); return els[k]; },
    querySelectorAll() { return []; },
    createElement() { return makeEl(); },
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'), readyState: 'complete'
  };
  const sb = Object.assign({
    document: doc, window: null, console, JSON, Math, Date, Object, Array, String, Number, Map, Set, RegExp, parseInt, parseFloat, isNaN,
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    CESTISCore: Core, showToast() {}, saveState() {}, openModal() {}, closeModal() {},
    __els: els
  }, extra || {});
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(helperSrc, sb);
  return sb;
}
function load(sb, names) { names.forEach(n => vm.runInContext(extractFunction(SRC, n), sb)); }
function render(label, names, setup, call, pick) {
  const sb = makeSandbox(setup);
  try {
    load(sb, names);
    const ret = vm.runInContext(call, sb);
    const html = pick ? pick(sb, ret) : ret;
    const fnSrc = names.map(n => extractFunction(SRC, n)).join('\n');
    assert(typeof html === 'string' && html.length > 0, label + ' produced markup');
    assertSafeMarkup(String(html), label, fnSrc);
    assert(String(html).indexOf('&lt;img src=x onerror=__pwn(1)&gt;') !== -1, label + ': the attack is shown as text');
    return { sb, html: String(html) };
  } catch (e) {
    assert(false, label + ' ran: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
    return { sb, html: '' };
  }
}
const el = (sb, id) => sb.__els[id] ? sb.__els[id].innerHTML : '';

console.log('The notification bell and the realtime channel');
{
  const notifications = [
    { id: 'N1', text: 'New support message from ' + EVIL, icon: ATTACK.tag, type: 'info', time: ATTACK.tag, read: false, forRoles: ['admin'] },
    { id: 'N2', text: '&#128222; ' + EVIL + ' started a call', icon: '&#128222;', type: 'success', time: 'Just now', read: true }
  ];
  const r = render('toggleNotifications', ['toggleNotifications'], {
    notifications, refreshNotificationTimes() {}, getFilteredNotifications() { return notifications; }
  }, 'toggleNotifications()', sb => sb.document.querySelector('.topbar-btn[title="Notifications"]').children[0].innerHTML);
  assert(r.html.indexOf('&#128222;') !== -1, 'the bell still shows an emoji stored as &#128222;');

  // A notification that arrived over the public broker is rebuilt from known fields.
  const sb = makeSandbox({
    notifications: [], userAccounts: [{ id: 'USR-001', role: 'admin' }], currentRole: 'admin',
    lmsChatGetCurrentUser() { return { id: 'USR-001' }; }, updateNotificationDot() {}, shakeNotificationBell() {},
    playNotificationSound() {}, saveNotifications() { sb.saved = true; }, cestisRefreshNotifDropdownIfOpen() {}, cestisRTHandleNudge() {}
  });
  load(sb, ['lmsChatRTUidFromPeerId', 'cestisNotifTargetsMe', 'cestisRTHandleNotify']);
  sb.payload = { type: 'notify', notif: { id: 'X1', text: ATTACK.tag, icon: ATTACK.tag, forRoles: ['admin'], evil: { a: 1 }, onclick: 'x' } };
  vm.runInContext('cestisRTHandleNotify(payload, "lmsrt-USR001")', sb);
  assertEq(sb.notifications.length, 1, 'a notification from a known account is stored');
  const stored = sb.notifications[0];
  assert(stored && !('evil' in stored) && !('onclick' in stored), 'only the known fields were kept');
  assertEq(stored && stored.icon, '🔔', 'its markup icon was replaced');
  vm.runInContext('cestisRTHandleNotify({type:"notify", notif:{id:"X2", text:"hi", forRoles:["admin"]}}, "lmsrt-NOBODY")', sb);
  assertEq(sb.notifications.length, 1, 'a notification from a peer id that is no account here is ignored');
  assert(/lmsChatRTHandleData\(data, conn\.peer\)/.test(extractFunction(SRC, 'lmsChatRTBindConn')),
    'the data channel passes the sender\'s peer id along');
}

console.log('Support Messages (the public form, no account needed)');
{
  const msgs = [{ id: "SUP-1');__pwn(9);//", name: EVIL, email: 'a"onmouseover="__pwn(6)@x.co', phone: ATTACK.svg, subject: EVIL, message: EVIL, timestamp: Date.now(), date: ATTACK.tag, read: false }];
  const setup = { supportMessages: msgs, loadSupportMessages() {}, saveSupportMessages() {}, getRelativeTime() { return 'now'; } };
  render('renderSupportMessagesPage', ['renderSupportMessagesPage'], setup, 'renderSupportMessagesPage()', sb => el(sb, 'supportMsgList'));
  const r = render('viewSupportMessage', ['viewSupportMessage'], setup, 'viewSupportMessage(' + JSON.stringify(msgs[0].id) + ')', sb => el(sb, 'supportMsgDetail'));
  const calls = handlerCalls(r.html).filter(c => c.name === 'deleteSupportMessage');
  assert(calls.length === 1 && calls[0].args[0] === msgs[0].id, 'Delete still reaches the message by its exact id');
}

console.log('Attendance registers (admin, instructor, admin staff, CMC)');
{
  /* The register is dated now (one mark per trainee per date): the renderers
     are the real ones, from the register's block of index.html, fed a mark
     whose every field is an attack as well as an old weekly row. */
  const A = Core.attendance;
  const sid = 'STU-1"onmouseover="__pwn(6)';
  const rec = { studentId: sid, studentName: EVIL, course: EVIL, days: { Mon: 'present', Tue: ATTACK.tag } };
  const today = A.localDate();
  const mark = { id: A.recordId(sid, today), studentId: sid, date: today, status: ATTACK.tag, markedAt: new Date().toISOString(),
    markedBy: EVIL, markedByName: EVIL, studentName: EVIL, course: EVIL, history: [{ status: ATTACK.tag, markedAt: '', markedBy: EVIL }] };
  const BLOCK_START = SRC.indexOf('/* ============================== ATTENDANCE REGISTER — ONE MARK PER DATE');
  const BLOCK_END = SRC.indexOf('\nfunction toggleAnnouncementForm(');
  assert(BLOCK_START > 0 && BLOCK_END > BLOCK_START, 'the dated register block is found in index.html');
  const block = SRC.slice(BLOCK_START, BLOCK_END);
  const common = {
    attendanceRecords: [rec], vcSessions: [], attnLoadedQuarter: null,
    attendanceRegister: [mark, Object.assign({}, mark, { id: A.recordId(sid, A.addDays(today, -1)), date: A.addDays(today, -1), status: 'present', history: undefined })],
    students: [{ id: sid, name: EVIL, course: EVIL, instructor: 'Ins', stage: 'training', gpa: ATTACK.tag, attendance: 90 }],
    studentCentreRecord() { return null; }, studentCourseStatus() { return 'active'; }, safeJsonParse(v, d) { try { return JSON.parse(v); } catch (e) { return d; } },
    CESTISStore: { getItem() { return null; }, setItem() {}, removeItem() {} }, saveCollection() { return true; }, currentAttendanceDate: '',
    instructorCourseMatch() { return true; }, currentInstructor: { name: 'Ins', course: EVIL }, currentRole: 'admin'
  };
  // The cells' and headers' handlers are written by these, so they are named
  // for the check that every handler in the markup is one the code writes.
  const run = (label, names, setup, call, pick) => render(label, ['localDateStr', 'attendanceCellHtml', 'attendanceHeadHtml', 'renderAttendanceGrid'].concat(names), Object.assign({ __block: block }, setup),
    'eval(__block);' + call, pick);
  const r = run('renderAttendancePage', ['renderAttendancePage'], common, 'renderAttendancePage()', sb => el(sb, 'attendanceTableBody'));
  assert(parseTags(r.html).some(t => t.attrs.some(a => a.name === 'data-sid' && a.value === sid)),
    'data-sid still decodes to the exact trainee id (updateAttendanceCell finds the mark)');
  run('renderInstructorAttendance', ['renderInstructorAttendance', 'attendanceInstructorFilter'], Object.assign({ _attInstructorCfg: {
    page: 'instructor', tbody: 'iAttendanceTableBody', head: 'iAttendanceTableHead', count: 'iAttCount', summary: 'iAttendanceSummary',
    chart: 'iWeeklyAttChart', live: 'iAttendanceLiveClasses', dateInput: 'iAttendanceDate', banner: 'iAttendanceLockBanner', showCourse: false } }, common),
    'renderInstructorAttendance()', sb => el(sb, 'iAttendanceTableBody'));
  run('renderAsAttendance', ['renderAsAttendance'], common, 'renderAsAttendance()', sb => el(sb, 'asAttBody'));
  run('cmcBuildAttendanceDetail', ['cmcBuildAttendanceDetail'], common, 'cmcBuildAttendanceDetail()');
  run('cmcBuildAttendanceDetail (weekly rows only)', ['cmcBuildAttendanceDetail'], Object.assign({}, common, { attendanceRegister: [] }), 'cmcBuildAttendanceDetail()');
  run('cmcBuildAttendanceDetail (no records)', ['cmcBuildAttendanceDetail'], Object.assign({}, common, { attendanceRecords: [], attendanceRegister: [] }), 'cmcBuildAttendanceDetail()');
  render('cmcBuildFeesDetail', ['cmcBuildFeesDetail'], common, 'cmcBuildFeesDetail()');
}

console.log('Certificates: the QR verify link and the admin pages');
{
  const q = 'STU-&quot;);__pwn(5);//';
  ['certificate', 'student'].forEach(kind => {
    const sb = makeSandbox();
    load(sb, ['_certWrongDoorCard']);
    const html = vm.runInContext('_certWrongDoorCard(' + JSON.stringify(kind) + ',' + JSON.stringify(q) + ')', sb);
    assertSafeMarkup(html, '_certWrongDoorCard(' + kind + ')', extractFunction(SRC, '_certWrongDoorCard'));
    const calls = handlerCalls(html);
    assert(calls.length === 1 && calls[0].args[0] === q, '_certWrongDoorCard(' + kind + ') passes the typed number through unchanged');
  });
  const sb = makeSandbox();
  load(sb, ['certPortalCertNoFromAddress']);
  assertEq(vm.runInContext('certPortalCertNoFromAddress("?certificate=STU-%26quot%3B)%3B__pwn()%2F%2F")', sb), null,
    'a crafted ?certificate= link does not open the portal');
  assertEq(vm.runInContext('certPortalCertNoFromAddress("?certificate=WE-2026-0001")', sb), 'WE-2026-0001', 'a real number still does');

  const s = { id: "STU-9');__pwn(2);//", name: EVIL, course: EVIL, certNo: EVIL, certDate: ATTACK.tag, stage: 'certified', certCollected: false };
  const setup = {
    students: [s], certTemplates: {}, getCertTemplateKey() { return 'k'; }, backfillCertificateNumbers() {},
    certDownloadApprovals: [{ studentId: s.id, approved: true, downloadCount: 3, name: EVIL, course: EVIL, certNo: EVIL, approvedBy: EVIL, lastDownloaded: '2026-01-01' }],
    isStudentCertified() { return true; }, isStudentPassed() { return true; },
    dedupeCertDownloadApprovals() { return false; }, reconcileCertifiedFromApprovals() {}, populateCertTemplateSkillSelect() {},
    renderCertSeedStatus() {}, renderCertDlStats() {}, renderCertDlLog() {},
    // The eligibility badge (its tooltip carries record text) and the signed
    // badge, added with the certificate checklist; the panel draws itself.
    certEligibilityContext() { return {}; },
    certEligibilityFor() { return { warnings: 1, items: [{ key: 'fees', label: EVIL, state: 'warn', detail: EVIL }] }; },
    certSignedFields() { return {}; }, renderCertSigningPanel() {}
  };
  render('renderCerts', ['renderCerts'], setup, 'renderCerts()', sb2 => el(sb2, 'certTableBody'));
  const r = render('renderCertDownloadMgmt', ['renderCertDownloadMgmt', 'certEligibilityText', 'certEligibilityBadge'], setup, 'renderCertDownloadMgmt()', sb2 => el(sb2, 'certDlStudentList'));
  const calls = handlerCalls(r.html).filter(c => /revokeCertDownload|approveCertDownload|certRegisterPrintedNumber/.test(c.name));
  assert(calls.length > 0 && calls.every(c => c.args[0] === s.id), 'the certificate buttons still pass the exact trainee id');
  render('renderCertDlLog', ['renderCertDlLog'], setup, 'renderCertDlLog()', sb2 => el(sb2, 'certDlLogBody'));
  render('openBulkCertApproveModal', ['openBulkCertApproveModal'], Object.assign({}, setup, { certDownloadApprovals: [] }), 'openBulkCertApproveModal()', sb2 => el(sb2, 'bulkCertList'));
}

console.log('LMS Chat: messages, file names, rooms, avatars');
{
  const me = { id: 'USR-ME', name: 'Me', role: 'admin' };
  const room = { id: "R1');__pwn(2);//", name: EVIL, icon: ATTACK.tag, color: 'red;"onmouseover="__pwn(6)', type: 'group', members: ['USR-ME', 'USR-X'] };
  const msgs = [
    { id: 'M1', roomId: room.id, senderId: 'USR-X', senderName: EVIL, type: 'text', text: 'https://x.co/"style="animation-name:spin"onanimationstart="__pwn(1)"x ' + EVIL, timestamp: Date.now() },
    { id: 'M2', roomId: room.id, senderId: 'USR-X', senderName: EVIL, type: 'file', fileName: "notes');__pwn(2);('.pdf" + ATTACK.tag, fileUrl: ATTACK.js, text: EVIL, timestamp: Date.now() },
    { id: "M3');__pwn(2);//", roomId: room.id, senderId: 'USR-X', type: 'image', imageData: EVIL_URL, timestamp: Date.now() }
  ];
  const setup = {
    lmsChatActiveRoom: room.id, lmsChatRooms: [room], lmsChatMessages: { [room.id]: msgs }, currentRole: 'admin',
    userAccounts: [me, { id: 'USR-X', name: EVIL, role: 'student', programme: EVIL }],
    lmsChatGetCurrentUser() { return me; }, lmsChatRenderCallBanner() {},
    lmsChatGetProfile() { return { profilePic: EVIL_URL, status: 'online"onmouseover="__pwn(6)' }; },
    lmsChatGetUserRooms() { return [room]; }, lmsChatCountUnread() { return 0; },
    lmsChatRenderPoll() { return ''; }
  };
  const helpers = ['lmsChatFormatDate', 'lmsChatFormatFullTime', 'lmsChatFormatTime', 'lmsChatGetFileIcon', 'lmsChatFormatFileSize', 'lmsChatGetUserInitials'];
  const r = render('lmsChatRenderMessages', helpers.concat(['lmsChatRenderMessages']), setup, 'lmsChatRenderMessages("admin")', sb => el(sb, 'adminChatMessages'));
  const dl = handlerCalls(r.html).filter(c => c.name === 'lmsChatDownloadFile');
  assert(dl.length === 1 && dl[0].args[1] === msgs[1].fileName, 'an attachment named with an apostrophe still downloads by its exact name');
  render('lmsChatRenderRoomList', helpers.concat(['lmsChatRenderRoomList']), setup, 'lmsChatRenderRoomList("admin")', sb => el(sb, 'adminChatList'));
  render('lmsChatRenderInfoPanel', helpers.concat(['lmsChatRenderInfoPanel']), setup, 'lmsChatRenderInfoPanel("admin")', sb => el(sb, 'adminChatInfoBody'));
  render('lmsChatGetAvatarHTML', helpers.concat(['lmsChatGetAvatarHTML']), setup, 'lmsChatGetAvatarHTML("USR-X", ' + JSON.stringify(EVIL) + ', 40) + "' + H.esc(ATTACK.tag) + '"');
  const sbCall = render('lmsChatShowIncomingCallNotif', ['lmsChatShowIncomingCallNotif'], setup,
    'lmsChatShowIncomingCallNotif(lmsChatRooms[0], {id:"USR-X", name:' + JSON.stringify(EVIL) + '}, "video", "USR-ME")',
    sb => sb.document.body.children[0] ? sb.document.body.children[0].innerHTML : '');
}

console.log('Announcements, calendars and the duty register');
{
  const ann = { id: "A1');__pwn(2);//", title: EVIL, body: EVIL, author: EVIL, priority: 'urgent" onmouseover="__pwn(6)', date: ATTACK.tag, forRoles: ['admin', 'instructor', ATTACK.tag], targetRoles: ['admin', ATTACK.tag] };
  const setup = {
    announcements: [ann], currentInstructor: { name: EVIL, course: 'X' }, currentRole: 'admin', currentLoggedInUser: { id: 'U1' },
    calendarEvents: [{ title: EVIL, date: '2026-10-20', time: ATTACK.tag, type: ATTACK.tag, color: 'red;"onmouseover="__pwn(6)', forRoles: [ATTACK.tag] }],
    instructorCourseMatch() { return true; }
  };
  render('renderAnnouncements', ['renderAnnouncements'], setup, 'renderAnnouncements()', sb => el(sb, 'announcementsList'));
  render('renderInstructorAnnouncements', ['renderInstructorAnnouncements'], setup, 'renderInstructorAnnouncements()', sb => el(sb, 'iAnnouncementsList'));
  render('renderCalendarEventList', ['renderCalendarEventList'], setup, 'renderCalendarEventList()', sb => el(sb, 'calEventList'));
}

console.log('Coursework: assignments, submissions, file names, resource links');
{
  const file = { name: ATTACK.tag + ATTACK.js, dataUrl: EVIL_URL, size: 10 };
  const a = {
    id: "AS1');__pwn(2);//", title: EVIL, instructions: EVIL, type: ATTACK.tag, dueDate: ATTACK.tag, maxPoints: 10, weight: ATTACK.tag,
    course: 'Welding', createdBy: EVIL, status: 'active', attachments: [file], driveFiles: [{ name: EVIL, webViewLink: EVIL_URL }],
    submissions: [{ studentId: 'STU-1', comment: ATTACK.attr + ATTACK.tag, submittedAt: '2026-01-01', files: [file], driveFiles: [{ name: EVIL, webViewLink: EVIL_URL }] }],
    grades: {}
  };
  const setup = {
    instructorAssignments: [a], students: [{ id: 'STU-1', name: EVIL, course: 'Welding' }],
    assignmentSubmissions: [Object.assign({ assignmentId: a.id }, a.submissions[0])],
    currentInstructor: { name: EVIL, course: 'Welding' }, currentStudent: { id: 'STU-1', name: EVIL, course: 'Welding' },
    instructorCourseMatch() { return true; }, currentRole: 'admin'
  };
  render('renderInstructorGradebook', ['renderInstructorGradebook'], setup, 'renderInstructorGradebook()', sb => el(sb, 'iCustomAssignmentsList'));
  const st = render('renderStudentAssignmentsPage', ['renderStudentAssignmentsPage'], setup, 'renderStudentAssignmentsPage()', sb => Object.values(sb.__els).map(e => e.innerHTML).join(''));
  const opens = handlerCalls(st.html).filter(c => c.name === 'openSubmitAssignment');
  assert(opens.length > 0 && opens.every(c => c.args[0] === a.id && c.args[1] === a.title), 'Upload Submission passes the exact id and title');

  const res = { id: "RS1');__pwn(2);//", resourceId: EVIL, name: EVIL, description: EVIL, url: EVIL_URL, category: 'video', type: ATTACK.tag, format: ATTACK.tag, course: 'Welding', createdBy: EVIL, uploadedAt: '2026-01-01' };
  const okRes = Object.assign({}, res, { id: 'RS2', url: 'https://drive.google.com/x\');__pwn(2);//' });
  const rs = {
    driveResources: [res, okRes], instructorResources: [res, okRes], _sResFilter: 'all', currentStudent: { id: 'S', course: 'Welding', name: 'S' },
    currentInstructor: { name: 'I', course: 'Welding' }, skillAreas: [{ name: 'Welding', icon: ATTACK.tag, color: 'red;"x="' }],
    instructorCourseMatch() { return true; }, findSkillAreaForCourse() { return { name: 'Welding', icon: ATTACK.tag, color: '#fff' }; }
  };
  const sd = render('renderStudentDriveResources', ['renderStudentDriveResources'], rs, 'renderStudentDriveResources()', sb => Object.values(sb.__els).map(e => e.innerHTML).join(''));
  const opened = handlerCalls(sd.html).filter(c => c.name === 'window.open');
  assert(opened.length > 0 && opened.every(c => /^https:\/\//.test(c.args[0])), 'Open/Play only ever opens a web link — the javascript: resource has no button');
  assert(opened.some(c => c.args[0] === okRes.url), 'and a web link containing a quote opens exactly that link');
  render('renderAsResources', ['renderAsResources'], rs, 'renderAsResources()', sb => el(sb, 'asResBody'));
}

console.log('Exams: lists, questions, results');
{
  const e = {
    id: 'E1', title: EVIL, course: EVIL, date: '2026-10-20', time: ATTACK.tag, duration: ATTACK.tag, status: 'upcoming', passMark: ATTACK.tag,
    instructions: EVIL, passRate: ATTACK.tag, createdBy: 'x',
    questionData: [{ type: 'mcq', text: EVIL, options: [ATTACK.tag, '<p>', '<div>'], correctAnswer: 0, points: 1 }, { type: 'short', text: EVIL, correctAnswer: EVIL, points: 2 }]
  };
  const setup = {
    exams: [e], examResults: [{ id: "R1');__pwn(2);//", examId: 'E1', studentId: 'STU-1', score: ATTACK.tag, correctCount: 1, totalQuestions: 2, passed: true, submittedAt: '2026-10-20T10:00:00Z', answers: [] }],
    students: [{ id: 'STU-1', name: EVIL }], currentRole: 'admin', currentInstructor: { name: 'x', course: EVIL }, currentLoggedInUser: { id: 'U' },
    instructorCourseMatch() { return true; }, examCanEdit() { return true; }, canEditExam() { return true; },
    adminExamFilter: 'upcoming', resolveExamStatuses() {}
  };
  render('renderExams', ['renderExams'], setup, 'renderExams()', sb => Object.values(sb.__els).map(x => x.innerHTML).join(''));
  const d = render('viewExamDetail', ['viewExamDetail'], setup, 'viewExamDetail(0)', sb => Object.values(sb.__els).map(x => x.innerHTML).join(''));
  assert(d.html.indexOf('A. &lt;p&gt;') !== -1 || d.html.indexOf('&lt;p&gt;') !== -1, 'an option written "<p>" is shown, not swallowed as markup');
  const vr = render('viewExamResults', ['viewExamResults'], setup, 'viewExamResults(0)', sb => Object.values(sb.__els).map(x => x.innerHTML).join(''));
  const g = handlerCalls(vr.html).filter(c => c.name === 'openGradingPanel');
  assert(g.length === 1 && g[0].args[0] === "R1');__pwn(2);//", 'Grade/Review still passes the exact result id');
}

console.log('Video classes: lists, lobby, conference, participants');
{
  const cs = { id: "CS1');__pwn(2);//", name: EVIL, createdBy: EVIL, instructor: EVIL, date: '2026-10-20', time: '09:00', endTime: ATTACK.tag, duration: ATTACK.tag, location: EVIL, students: ATTACK.tag, roomCode: "AB'C\"D", course: 'Welding', status: 'live', type: 'theory' };
  const m = { id: "MT1');__pwn(2);//", title: EVIL, description: EVIL, createdBy: EVIL, date: ATTACK.tag, time: '10:00', duration: ATTACK.tag, roomCode: ATTACK.js, access: 'allstaff', createdById: 'U' };
  const setup = {
    classSessions: [cs], adminMeetings: [m], currentLoggedInUser: { id: 'U' }, currentInstructor: { name: EVIL, course: 'Welding' },
    currentStudent: { id: 'S', name: EVIL, course: 'Welding', instructor: EVIL }, instructorCourseMatch() { return true; },
    localDateStr() { return '2026-10-20'; }, instructorResources: [], driveResources: [{ category: 'video', name: EVIL, url: EVIL_URL, course: 'Welding' }]
  };
  const ac = render('renderAdminClassSessions', ['renderAdminClassSessions'], setup, 'renderAdminClassSessions()', sb => el(sb, 'adminClassSessionsList') + el(sb, 'adminAllSessionsList'));
  const joins = handlerCalls(ac.html).filter(c => c.name === 'enterVideoRoom');
  assert(joins.length === 2 && joins.every(c => c.args[0] === EVIL && c.args[2] === cs.roomCode), 'Join passes the exact class name and room code (an apostrophe used to break it)');
  render('renderAdminMeetingsList', ['meetingAccess', 'meetingAccessBadge', 'renderAdminMeetingsList'], setup, 'renderAdminMeetingsList()', sb => el(sb, 'adminMeetingsList') + el(sb, 'asAdminMeetingsList') + el(sb, 'iAdminMeetingsList'));
  render('renderInstructorClassSessions', ['renderInstructorClassSessions'], setup, 'renderInstructorClassSessions()', sb => el(sb, 'iClassSessionsList'));
  render('renderStudentClassSessions', ['renderStudentClassSessions'], setup, 'renderStudentClassSessions()', sb => el(sb, 'sClassSessionsList'));
  const rec = render('renderStudentRecordings', ['renderStudentRecordings'], Object.assign({}, setup, { classSessions: [Object.assign({}, cs, { status: 'completed', recordingUrl: 'https://x.co/\');__pwn(2);//' })] }), 'renderStudentRecordings()', sb => el(sb, 'sPastRecordingsList'));
  assert(handlerCalls(rec.html).filter(c => c.name === 'window.open').every(c => /^https:/.test(c.args[0])), 'Watch never opens a javascript: link');

  const vsb = makeSandbox({
    peerNames: { p1: EVIL }, peerRoles: { p1: ATTACK.tag }, mutedPeers: {}, vcCoHosts: {}, isRoomHost: true, rtcPeer: { id: 'me' },
    vcCurrentUserName: EVIL, vcCurrentRole: 'admin'
  });
  load(vsb, ['vcCleanPeerName', 'vcCleanPeerRole', 'vcUpdateParticipants']);
  vm.runInContext('vcUpdateParticipants()', vsb);
  const parts = el(vsb, 'vc-part-list');
  assertSafeMarkup(parts, 'vcUpdateParticipants', extractFunction(SRC, 'vcUpdateParticipants'));
  assertEq(vm.runInContext('vcCleanPeerRole("admin\\"><img>")', vsb), 'student', 'a self-declared role must be a real one');
  assertEq(vm.runInContext('vcCleanPeerRole("instructor")', vsb), 'instructor', 'a real role is kept');
  const conf = render('vcShowConference', ['vcShowConference'], {
    vcCurrentUserName: EVIL, isRoomHost: true, currentRoomCode: ATTACK.tag, localStream: null,
    vcUpdateParticipants() {}, vcRestoreChatHistory() {}, videoTimerInterval: null, videoSeconds: 0
  }, 'vcShowConference(' + JSON.stringify(EVIL) + ', "admin")', sb => el(sb, 'videoRoom'));
  const send = handlerCalls(conf.html).filter(c => c.name === 'sendChatMsg');
  assert(send.length === 2 && send.every(c => c.args[1] === EVIL), 'Send passes the exact sender name (an apostrophe used to break chat)');
}

console.log('Dashboards: Top Performers, Recent Activity, instructor roster, skill areas');
{
  render('renderInstructorStudents', ['renderInstructorStudents'], {
    students: [{ id: ATTACK.tag, name: EVIL, course: 'W', score: ATTACK.tag, gpa: ATTACK.tag, stage: ATTACK.tag, attendance: '90;"x="', progress: ATTACK.tag, instructor: 'I' }],
    currentInstructor: { name: 'I', course: 'W' }, instructorCourseMatch() { return true; }, stageBadge: {}, stageLabels: {}
  }, 'renderInstructorStudents(students)', sb => Object.values(sb.__els).map(x => x.innerHTML).join(''));
  const sk = { id: 7, name: EVIL, icon: ATTACK.tag, color: 'red;"onmouseover="__pwn(6)', desc: EVIL, students: ATTACK.tag, materials: 1 };
  render('renderSkills', ['renderSkills'], { skillAreas: [sk], currentRole: 'admin', cdCardDurationBadge() { return ''; }, updateSkillAreaCounts() {} }, 'renderSkills()', sb => Object.values(sb.__els).map(x => x.innerHTML).join(''));
  render('renderCentreTable', ['renderCentreTable'], { skillAreas: [sk], centreDisplayName(c) { return c.name; }, cdCardDurationBadge() { return ''; } }, 'renderCentreTable()', sb => Object.values(sb.__els).map(x => x.innerHTML).join(''));
}

/* =====================================================================
   4. Staff appraisals: a name with an apostrophe
   ===================================================================== */
console.log('Staff appraisal roster buttons work for "Dwayne O\'Connor"');
{
  const libSrc = read('staff-appraisals.js');
  const els = {};
  const store = { voctrain_users: JSON.stringify([{ id: 'U1', name: "Dwayne O'Connor", role: 'instructor' }, { id: 'U2', name: 'Kevin <img src=x onerror=__pwn(1)> Brown', role: 'adminstaff' }]) };
  const sb = {
    console, JSON, Math, Date, Object, Array, String, Number, RegExp, parseInt, parseFloat, isNaN, setTimeout() {}, clearTimeout() {},
    document: { getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; }, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return makeEl(); }, addEventListener() {} },
    localStorage: { getItem(k) { return store[k] || null; }, setItem(k, v) { store[k] = v; }, removeItem(k) { delete store[k]; } },
    addEventListener() {}
  };
  sb.window = sb; sb.CESTISStore = sb.localStorage;
  vm.createContext(sb);
  try {
    vm.runInContext(libSrc, sb);
    sb.currentRole = 'admin';
    vm.runInContext('sappOnPageShow()', sb);
    const html = els.sappRosterWrap ? els.sappRosterWrap.innerHTML : '';
    assert(html.indexOf("O&#39;Connor") !== -1, 'the roster lists Dwayne O\'Connor');
    assertSafeMarkup(html, 'sappRenderRoster', libSrc);
    const calls = handlerCalls(html).filter(c => /^sapp/.test(c.name));
    assert(calls.length >= 6, 'every roster button still calls its function');
    assert(calls.some(c => c.args[0] === "USR:U1"), 'and O\'Connor\'s buttons pass his exact roster id');
  } catch (e) {
    assert(false, 'staff-appraisals roster renders: ' + e.message);
  }
}

/* =====================================================================
   5. A cheap static guard over the renderers fixed here
   ===================================================================== */
console.log('No raw user field is concatenated into the fixed renderers again');
{
  const FIELDS = 'name|title|course|studentName|instructions|comment|description|body|author|message|subject|fileName|createdBy|location|assigneeName|senderName|profilePic|gpa|certNo|email|phone|programme|reason';
  const RAW = new RegExp("(?:\\+\\s*\\(?|\\$\\{\\s*\\(?)[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*\\.(?:" + FIELDS + ")\\b(?!\\s*\\()(?=\\s*(?:\\+|\\}|\\|\\||\\)))", 'g');
  const RENDERERS = ['toggleNotifications', 'renderSupportMessagesPage', 'viewSupportMessage', 'renderAttendancePage',
    'renderInstructorAttendance', 'cmcBuildAttendanceDetail', 'cmcBuildFeesDetail', 'renderCerts', 'renderCertDownloadMgmt',
    'renderCertDlLog', 'openBulkCertApproveModal', 'lmsChatRenderMessages', 'lmsChatRenderRoomList', 'lmsChatRenderInfoPanel',
    'lmsChatManageMembers', 'lmsChatShowIncomingCallNotif', 'renderAnnouncements', 'renderInstructorAnnouncements', 'adrOpenTaskDetail',
    'renderCalendarEventList', 'renderInstructorGradebook', 'renderStudentAssignmentsPage', 'renderStudentAssignments',
    'renderAdminAssignments', 'renderInstructorCustomResources', 'renderAdminResources', 'renderStudentDriveResources',
    'showSkillDetail', 'renderAsResources', 'renderExams', 'renderInstructorExams', 'viewExamDetail', 'viewExamResults',
    'renderStudentExams', 'renderInstructorStudents', 'renderAdminClassSessions', 'renderAdminMeetingsList',
    'renderInstructorClassSessions', 'renderStudentClassSessions', 'renderStudentRecordings', 'renderInstructorRecordings',
    'enterVideoRoom', 'vcShowConference', 'vcUpdateParticipants', 'renderSkills', 'renderCentreTable'];
  RENDERERS.forEach(fn => {
    const body = extractFunction(SRC, fn).split('\n')
      .filter(l => !/addNotification|showToast\(|confirm\(|alert\(|textContent|console\.|^\s*\/\//.test(l)).join('\n');
    const raw = (body.match(RAW) || []);
    assert(raw.length === 0, fn + ' escapes every user field it prints (raw: ' + raw.slice(0, 3).join(', ') + ')');
    assert(!/\\''\s*\+\s*(?:escapeHtml|escapeAttr|lmsChatEscapeHtml|_certEsc|sanitizeInput)\(/.test(body),
      fn + ' never relies on HTML-escaping inside a quoted onclick string');
    assert(!/replace\(\/'\/g,\s*(?:'&#39;'|"\\\\'")\)/.test(body), fn + ' does not "escape" a quote for an onclick by hand');
  });
  assert(!/\.replace\(\/'\/g, *"\\\\'"\) *\+ *'\\',\\'_blank\\'\)/.test(SRC), 'no resource button builds window.open(\'...\') from a raw link');
  assert(/function lmsChatLinkify\(text\)[\s\S]{0,700}CESTISCore\.html\.linkify/.test(SRC), 'the chat linkifier is the shared one');
}

console.log('Shared libraries stay identical in both builds');
['cestis-core.js', 'staff-appraisals.js', 'cmc-portal.js'].forEach(lib =>
  assert(read(lib) === read('Offline System/' + lib), lib + ' is byte-identical in Offline System/'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
