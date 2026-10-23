/* Certificate page 2: the competencies carry on in a second column.

   The Centre reported: "Certificate page 2 — the second column goes outside
   the column instead of continuing in a second paragraph beside the first,
   like the first column."

   Page 2 prints two lists side by side: the units (clusters/modules) on the
   left, already split into two columns, and the Technical Competencies
   Achieved on the right. The competencies were drawn as ONE column that
   wrapped at the PAGE's right edge (w - colMid - 30) and had no foot: a long
   list ran over the frame on the right, then down through the Programme
   Specifications and off the page. Every wrapped line of a bullet got a
   bullet of its own, so one competency read as two. The units were split by
   count with no foot either, so a full qualification plan ran down into the
   QR code. And the template editor previewed fixed sample text, so none of
   this showed until a certificate was printed.

   Pinned here:
     1. CESTISCore.certs.layoutColumns (the pure rule): a short list stays in
        column 1; a long one carries on at the TOP of column 2, beside column
        1, the same width; every line wraps inside its own column; a wrapped
        entry is never split between columns and a heading never sits alone at
        a column's foot; continuation lines hang under the text with no second
        bullet; a list too long for two columns comes down a size at a time,
        to small print and no further, and never draws below its box; an empty
        list draws nothing. layoutColumnsShared keeps both lists at one size.
     2. renderCertPage2OnBg, run from index.html (both builds) on a seeded
        Welding Level 2 template and on long hand-written competencies: every
        list line inside its column, inside the frame and above the
        specifications, both competency columns used from the same top.
     3. The template editor's page-2 preview draws the template's own lists
        with the very same layout — line for line what the certificate prints.

   Run: node tests/cert-page2-columns.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const Seed = require('../cert-template-seed.js');
const PAGES = [
  { where: 'index.html', src: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), core: require('../cestis-core.js') },
  { where: 'Offline System/index.html', src: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8'), core: require('../Offline System/cestis-core.js') }
];
function extractFunction(src, name, where) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error(where + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error(where + ': unbalanced ' + name);
}

// A stand-in for the canvas's measureText: every character half the font's
// pixel size wide (bold a little wider). Deterministic, and font-aware, so a
// line measured in one font and drawn in another would show.
function pxOf(font) { const m = /(\d+(?:\.\d+)?)px/.exec(font || ''); return m ? parseFloat(m[1]) : 10; }
function measure(text, font) { return String(text).length * pxOf(font) * (/bold/.test(font) ? 0.55 : 0.5); }
const EPS = 0.001;

/* ---------------------------------------------------------------- 1. the rule */
for (const page of PAGES) {
  const w = page.where, K = page.core.certs;
  console.log(w + ': the two-column rule');
  const box = { x: 100, y: 200, width: 410, bottom: 500, columns: 2, gap: 10, padRight: 10 };
  const colW = (410 - 10) / 2;   // 200
  const within = (r) => r.lines.every(l => {
    const c = r.columns[l.column];
    return l.x >= c.x - EPS && l.x + measure(l.text, l.font) <= c.x + c.width - 10 + EPS;
  });
  const below = (r, b) => r.lines.every(l => l.y <= b.bottom + EPS && l.y >= b.y - EPS);
  const byEntry = (r) => { const m = {}; r.lines.forEach(l => { (m[l.entry] = m[l.entry] || []).push(l); }); return m; };
  const group = (cat, items) => [{ text: cat + ':', style: 'head' }].concat(items.map(t => ({ text: t, style: 'item' })));

  // An empty list: nothing drawn, nothing shrunk.
  let r = K.layoutColumns([], measure, box, { size: 13, minSize: 9 });
  assert(r.lines.length === 0 && r.fits && r.size === 13 && r.hidden === 0, w + ': an empty list draws nothing and keeps its size');
  r = K.layoutColumns([{ text: '   ', style: 'item' }, null], measure, box, { size: 13 });
  assert(r.lines.length === 0 && r.fits, w + ': blank entries draw nothing either');

  // A short list stays in the first column.
  const short = group('Customer Care', ['Greet and serve customers courteously', 'Identify customer needs'])
    .concat(group('Communication', ['Handle complaints calmly']));
  r = K.layoutColumns(short, measure, box, { size: 13, minSize: 9 });
  assert(r.fits && r.size === 13, w + ': a short list prints at the template\'s own size');
  assert(r.lines.every(l => l.column === 0), w + ': and stays in column 1');
  assertEq(r.lines[0].y, 200, w + ': starting at the top of the box');
  assertEq(r.lines[0].x, 110, w + ': a heading 10px inside the column');
  assertEq(r.lines[1].x, 120, w + ': its entries 20px inside');
  assert(/^ {2}• {2}Greet/.test(r.lines[1].text), w + ': each entry starts with its bullet');

  // A long list carries on at the top of column 2, beside column 1.
  const items = [];
  for (let i = 1; i <= 30; i++) items.push('Competency statement number ' + i + ' that is long enough to wrap onto a second line here');
  const long = group('Area one', items.slice(0, 10)).concat(group('Area two', items.slice(10, 20)), group('Area three', items.slice(20, 30)));
  r = K.layoutColumns(long, measure, box, { size: 8, minSize: 8 });
  assert(r.fits, w + ': a long list fits in two columns');
  assert(r.lines.some(l => l.column === 0) && r.lines.some(l => l.column === 1), w + ': and uses both');
  const c2 = r.lines.filter(l => l.column === 1);
  assertEq(c2[0].y, 200, w + ': column 2 starts at the same top as column 1');
  assertEq(r.columns[1].x, 100 + colW + 10, w + ': directly beside column 1 (one gap along)');
  assertEq(r.columns[0].width, r.columns[1].width, w + ': and just as wide');
  assert(Math.min.apply(null, c2.map(l => l.x)) >= r.columns[1].x + 10 - EPS, w + ': with the same margins inside it');
  const lastCol1 = r.lines.filter(l => l.column === 0).pop();
  assert(r.lines.indexOf(lastCol1) + 1 === r.lines.indexOf(c2[0]), w + ': it continues in order — column 1 to the foot, then column 2');
  assert(within(r), w + ': every line wraps inside its own column');
  assert(below(r, box), w + ': and none runs below the box');
  const entries = byEntry(r);
  assert(Object.keys(entries).every(k => entries[k].every(l => l.column === entries[k][0].column)), w + ': a wrapped entry is never split between the columns');
  assert(Object.keys(entries).some(k => entries[k].length > 1), w + ': (the entries do wrap)');
  r.lines.forEach((l, i) => {
    if (l.style !== 'head' || !l.first) return;
    const next = r.lines.slice(i + 1).find(n => n.entry !== l.entry);
    if (next) assert(next.column === l.column, w + ': a heading is never left alone at the foot of a column (' + l.text + ')');
  });
  // Continuation lines: no second bullet, hung under the text.
  const wrapped = Object.keys(entries).map(k => entries[k]).find(ls => ls.length > 1 && ls[0].style === 'item');
  const markerW = measure('  •  ', wrapped[0].font);
  assert(wrapped.slice(1).every(l => l.text.indexOf('•') === -1), w + ': a wrapped line carries no bullet of its own');
  assert(wrapped.slice(1).every(l => Math.abs(l.x - (wrapped[0].x + markerW)) < EPS), w + ': and starts under the text, not under the bullet');

  // Too long at the template's size: the font comes down, a step at a time.
  r = K.layoutColumns(long, measure, box, { size: 13, minSize: 6 });
  assert(r.fits && r.size < 13 && r.size >= 6, w + ': a list too long at 13px comes down to a size that fits (' + r.size + ')');
  assert(K.layoutColumns(long, measure, box, { size: r.size + 0.5, minSize: r.size + 0.5 }).hidden > 0, w + ': the largest size that fits (half a size up does not)');
  assert(within(r) && below(r, box), w + ': still inside its columns and above the foot');
  assert(r.lines.every(l => /^(bold )?\d+px Arial/.test(l.font)), w + ': each line says the font it was measured in, to draw it in');

  // Too long even at the smallest size: what fits is drawn, the rest counted — never drawn outside.
  const huge = long.concat(long, long, long);
  r = K.layoutColumns(huge, measure, box, { size: 13, minSize: 8 });
  assert(!r.fits && r.hidden > 0 && r.size === 8, w + ': a list too long even in small print says how much is left out (' + r.hidden + ')');
  assert(within(r) && below(r, box), w + ': and draws nothing outside the box');
  assert(r.lines.every(l => l.column < 2), w + ': nor in a third column');

  // A word longer than the column is broken, not run past the edge.
  r = K.layoutColumns([{ text: 'https://cestis.example.org/' + 'x'.repeat(120), style: 'item' }], measure, box, { size: 10 });
  assert(r.lines.length > 1 && within(r), w + ': an unbreakable word is broken at the column edge');

  // Balanced (the units): the columns end level, each cluster kept whole.
  const units = [];
  for (let m = 1; m <= 6; m++) units.push.apply(units, [{ text: 'Cluster ' + m + ' 120 Contact Hours', style: 'head', marker: '☑ ' }].concat(
    [1, 2, 3].map(t => ({ text: 'Unit ' + m + '.' + t + ' title', style: 'item' }))));
  r = K.layoutColumns(units, measure, box, { size: 10, mode: 'balance', keepGroups: true, groupGap: 4 });
  const foot = c => Math.max.apply(null, r.lines.filter(l => l.column === c).map(l => l.y));
  assert(r.fits && r.lines.some(l => l.column === 1), w + ': balanced, a short list of units still shares both columns (as before)');
  assert(Math.abs(foot(0) - foot(1)) <= 4 * 11 + 4, w + ': and the two columns end within a cluster of each other (' + foot(0) + ' / ' + foot(1) + ')');
  const ue = byEntry(r);
  let heads = r.lines.filter(l => l.style === 'head');
  assert(heads.every(h => { const i = r.lines.indexOf(h); const own = r.lines.slice(i + 1, i + 4); return own.every(l => l.column === h.column); }), w + ': every cluster kept whole in one column');
  assertEq(heads[0].text.indexOf('☑ '), 0, w + ': a unit heading keeps its tick');
  assert(Object.keys(ue).length === units.length, w + ': nothing left out');

  // Two lists at one size: the longer one decides for both.
  const sets = [
    { entries: short, box: box, opts: { size: 13, minSize: 6 } },
    { entries: long, box: { x: 600, y: 200, width: 410, bottom: 500, columns: 2, gap: 10, padRight: 10 }, opts: { size: 13, minSize: 6 } }
  ];
  const both = K.layoutColumnsShared(sets, measure);
  assert(both[1].size < 13 && both[0].size === both[1].size, w + ': two lists on one page print at one size (' + both[0].size + ' / ' + both[1].size + ')');
  assert(both.every(l => l.fits), w + ': and both fit');

  // Small print: about 5pt once the page is fitted to A4, never above the template's size.
  assertEq(K.listMinSize(11, 1123, 794), 8.5, w + ': on a 1123×794 background the lists go no smaller than 8.5 (≈5pt body text)');
  assertEq(K.listMinSize(13, 3508, 2480), 13, w + ': a template already at small print is never shrunk further');
  assert(K.listMinSize(40, 3508, 2480) < 40 && K.listMinSize(40, 3508, 2480) >= 26, w + ': a large template may come down to small print (' + K.listMinSize(40, 3508, 2480) + ')');
}

/* --------------------------------------------- 2. the certificate's page 2 */
const W = 1123, H = 794, FRAME = { left: 18, right: 1105, top: 18, bottom: 776 };
function fakeCanvas() {
  const calls = [];
  const state = { font: '10px Arial', fillStyle: '#000', textAlign: 'start' };
  const ctx = {
    calls,
    get font() { return state.font; }, set font(v) { state.font = v; },
    get fillStyle() { return state.fillStyle; }, set fillStyle(v) { state.fillStyle = v; },
    get textAlign() { return state.textAlign; }, set textAlign(v) { state.textAlign = v; },
    strokeStyle: '', lineWidth: 1,
    fillText(t, x, y) { calls.push({ t: String(t), x, y, font: state.font, align: state.textAlign, fill: state.fillStyle }); },
    measureText(t) { return { width: measure(t, state.font) }; },
    // The background: a dark frame round a light page.
    getImageData(x, y, ww, hh) {
      const d = new Uint8ClampedArray(ww * hh * 4);
      for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) {
        const px = x + i, py = y + j, o = (j * ww + i) * 4;
        const dark = px < FRAME.left || px >= FRAME.right || py < FRAME.top || py >= FRAME.bottom;
        d[o] = dark ? 27 : 253; d[o + 1] = dark ? 42 : 248; d[o + 2] = dark ? 74 : 236; d[o + 3] = 255;
      }
      return { data: d };
    },
    drawImage() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    strokeRect() {}, fillRect() {}, setLineDash() {}
  };
  return { width: 0, height: 0, getContext: () => ctx, ctx };
}
const POS = {
  p2TitleX: 50, p2TitleY: 9, p2TitleSize: 24, p2HeaderX: 50, p2HeaderY: 15, p2HeaderSize: 14,
  p2ContentX: 4, p2ContentY: 25, p2ContentSize: 11, p2ModHeadX: 4, p2ModHeadY: 25, p2ModHeadSize: 16,
  p2CompHeadX: 52, p2CompHeadY: 25, p2CompHeadSize: 16, p2SpecsX: 50, p2SpecsY: 79, p2SpecsSize: 10,
  p2FooterX: 50, p2FooterY: 89, p2FooterSize: 9, p2QrX: 3, p2QrY: 87, p2QrSize: 7
};
const welding = Seed.templateContentFor('Welding');
const TEMPLATES = {
  'a seeded Welding Level 2 plan': {
    courseFullName: 'NVQ-J Level 2 in Welding', courseType: welding.courseType, programmeCode: welding.programmeCode,
    modules: welding.modules, competencies: welding.competencies, programmeSpecs: welding.programmeSpecs, textPositions: POS
  },
  'long hand-written competencies': {
    courseFullName: 'Electrical Installation', courseType: 'Full-time', programmeCode: 'EEM20723', textPositions: POS,
    modules: [{ name: 'Follow Workplace Safety', contactHours: 135, topics: ['Apply basic electrical safety'] }],
    competencies: [1, 2, 3, 4, 5].map(n => ({
      category: 'Installation, Inspection, Testing and Commissioning Area ' + n,
      items: [
        'Plan, measure, mark out and install PVC and metallic conduit, trunking, cable tray and ladder systems to drawings, specifications and the manufacturers’ instructions',
        'Carry out continuity, insulation resistance, polarity, earth fault loop impedance and RCD tests and record the results on an electrical installation certificate',
        'Diagnose and rectify faults in single-phase and three-phase circuits, motors and control equipment using approved test instruments'
      ]
    }))
  }
};
function sandbox(page, canvas) {
  const sb = {
    CESTISCore: page.core, console: { warn() {}, log() {} }, Math, String, JSON, parseInt, parseFloat,
    document: { createElement: () => canvas },
    certDrawValidationQr: function () {}
  };
  vm.createContext(sb);
  const fns = ['wrapText', 'certPageInnerBounds', 'certQrGeometry', 'certPageInnerBox', 'certPage2Lists', 'certDrawListLines', 'renderCertPage2OnBg', '_cpv', '_certEditorPage2Content', '_renderCertLivePreviewP2'];
  vm.runInContext('var CERT_QR_DEFAULTS = { x: 3, y: 87, size: 7 };\n' + fns.map(n => extractFunction(page.src, n, page.where)).join('\n'), sb);
  return sb;
}
const listLine = (c) => /px Arial/.test(c.font) && !/^bold 16px/.test(c.font) && c.align === 'left';

for (const page of PAGES) {
  const w = page.where;
  for (const name of Object.keys(TEMPLATES)) {
    console.log(w + ': page 2 of ' + name);
    const tpl = TEMPLATES[name];
    const canvas = fakeCanvas();
    const sb = sandbox(page, canvas);
    sb.tpl = tpl;
    vm.runInContext("renderCertPage2OnBg({ naturalWidth: " + W + ", naturalHeight: " + H + " }, { course: 'Welding', certNo: 'WE-2026-4821-KX' }, tpl)", sb);
    const calls = canvas.ctx.calls;
    // The layout the page drew from, recomputed the same way.
    const p2 = page.core.certTemplate.page2Content(tpl);
    const lists = vm.runInContext('certPage2Lists', sb)(fakeCanvas().ctx, W, H, {
      modules: p2.modules, competencies: p2.competencies, contentX: 4 / 100 * W, contentSize: 11,
      modHeadY: 25 / 100 * H, modHeadSize: 16, compHeadX: 52 / 100 * W, compHeadY: 25 / 100 * H, compHeadSize: 16,
      specsY: 79 / 100 * H, specsSize: 10, footerY: 89 / 100 * H, footerSize: 9, tpl
    });
    const drawn = (l) => calls.some(c => c.t === l.text && Math.abs(c.x - l.x) < EPS && Math.abs(c.y - l.y) < EPS && c.font === l.font);
    assert(lists.units.lines.length && lists.units.lines.every(drawn), w + ': every unit line is drawn where the layout puts it');
    assert(lists.competencies.lines.length && lists.competencies.lines.every(drawn), w + ': every competency line is drawn where the layout puts it');
    assertEq(lists.hidden, 0, w + ': the whole of both lists is on the page');

    const comp = lists.competencies, box = lists.rightBox;
    const specsTop = 79 / 100 * H - 10;
    assert(comp.lines.some(l => l.column === 0) && comp.lines.some(l => l.column === 1), w + ': the competencies carry on in a second column');
    assertEq(comp.lines.filter(l => l.column === 1)[0].y, comp.lines[0].y, w + ': which starts at the same top as the first');
    assert(comp.columns[1].x > comp.columns[0].x + comp.columns[0].width - EPS && comp.columns[1].x < comp.columns[0].x + comp.columns[0].width + 20, w + ': directly beside it');
    // Inside its column, inside the frame (the same margin from the right as
    // the units have from the left), above the specifications.
    const rightLimit = W - 4 / 100 * W - 10;
    assert(comp.lines.every(l => { const c = comp.columns[l.column]; return l.x + measure(l.text, l.font) <= c.x + c.width - 10 + EPS; }), w + ': every competency line wraps inside its own column');
    assert(comp.lines.every(l => l.x + measure(l.text, l.font) <= rightLimit + EPS), w + ': none runs past the right margin (' + rightLimit.toFixed(1) + ')');
    assert(lists.units.lines.concat(comp.lines).every(l => l.y < specsTop), w + ': no list line reaches the Programme Specifications');
    assert(comp.lines.every(l => l.x >= box.x), w + ': the competencies stay right of the units');
    assert(lists.units.lines.every(l => { const c = lists.units.columns[l.column]; return l.x + measure(l.text, l.font) <= c.x + c.width - 10 + EPS; }), w + ': and every unit line inside its own column');
    assert(lists.units.size === comp.size, w + ': both lists at one size (' + comp.size + ')');
    // Nothing left-aligned on the page — lists, headings — past the frame.
    const left = calls.filter(c => c.align === 'left');
    assert(left.every(c => c.x >= FRAME.left && c.x + measure(c.t, c.font) <= FRAME.right), w + ': nothing drawn past the frame');
    // A wrapped competency: one bullet, its other lines under the text.
    const firstWrapped = comp.lines.find((l, i) => l.first && l.style === 'item' && comp.lines[i + 1] && comp.lines[i + 1].entry === l.entry);
    assert(firstWrapped && calls.filter(c => c.t.indexOf('•') !== -1 && c.y > firstWrapped.y && c.y <= firstWrapped.y + 1.2 * 11 && Math.abs(c.x - firstWrapped.x) < EPS).length === 0,
      w + ': a wrapped competency has one bullet, not one per line');
  }
  const src = extractFunction(page.src, 'renderCertPage2OnBg', w);
  assert(src.indexOf('w - colMid - 30') === -1 && src.indexOf('certPage2Lists(ctx, w, h,') !== -1, w + ': the renderer no longer wraps at the page edge; it lays out with certPage2Lists');
  assert(src.lastIndexOf('certDrawValidationQr(') > src.lastIndexOf('certDrawListLines('), w + ': the QR is still drawn last');
}

/* ------------------------------------- 3. the template editor shows the same */
for (const page of PAGES) {
  const w = page.where;
  console.log(w + ': the template editor previews page 2 with the same layout');
  const tpl = TEMPLATES['a seeded Welding Level 2 plan'];
  const canvas = fakeCanvas();
  const sb = sandbox(page, canvas);
  const inputs = {
    ctplCourseFullName: tpl.courseFullName, ctplProgrammeCode: tpl.programmeCode, ctplVersion: '1.0', ctplDevelopedDate: 'May 2024', ctplCourseType: 'Fulltime Course'
  };
  Object.keys(POS).forEach(k => { inputs['ctpl' + k.charAt(0).toUpperCase() + k.slice(1)] = String(POS[k]); });
  const field = (v) => ({ value: v });
  const moduleDivs = tpl.modules.map(m => ({ querySelector: (s) => field(s === '.ctpl-mod-name' ? m.name : s === '.ctpl-mod-hours' ? String(m.contactHours) : m.topics.join('\n')) }));
  const compDivs = tpl.competencies.map(c => ({ querySelector: (s) => field(s === '.ctpl-comp-cat' ? c.category : c.items.join('\n')) }));
  sb.document = {
    createElement: () => fakeCanvas(),
    getElementById: (id) => id === 'certLivePreviewCanvasP2' ? canvas : (id in inputs ? field(inputs[id]) : null),
    querySelectorAll: (sel) => /cert-tpl-module/.test(sel) ? moduleDivs : /cert-tpl-comp/.test(sel) ? compDivs : []
  };
  sb._certLivePreviewImgP2 = { naturalWidth: W, naturalHeight: H };
  vm.runInContext('_renderCertLivePreviewP2()', sb);
  const preview = canvas.ctx.calls.filter(c => c.fill === 'rgba(80,200,80,0.9)' && c.align === 'left');

  const printed = fakeCanvas();
  const sb2 = sandbox(page, printed);
  sb2.tpl = tpl;
  vm.runInContext("renderCertPage2OnBg({ naturalWidth: " + W + ", naturalHeight: " + H + " }, { course: 'Welding', certNo: 'X' }, tpl)", sb2);
  const lines = printed.ctx.calls.filter(c => listLine(c) && c.y > 25 / 100 * H + 16 && c.y < 79 / 100 * H - 10);
  const key = c => c.t + '@' + c.x.toFixed(2) + ',' + c.y.toFixed(2) + ' ' + c.font;
  const want = lines.map(key).sort(), got = preview.map(key).sort();
  assert(want.length > 50, w + ': (the certificate prints the plan\'s ' + want.length + ' list lines)');
  assertEq(got.length, want.length, w + ': the preview draws as many list lines as the certificate');
  assert(want.every((k, i) => k === got[i]), w + ': the same lines, in the same places, in the same fonts — what staff see is what prints');
  const pv = extractFunction(page.src, '_renderCertLivePreviewP2', w);
  assert(pv.indexOf('Sample competency item\', compHeadX') === -1 && pv.indexOf('certPage2Lists(ctx, w, h,') !== -1, w + ': the preview no longer draws fixed sample text');
  assert(extractFunction(page.src, 'openCertTemplateEditor', w).indexOf("pos.p2ContentX || 4;") !== -1, w + ': the editor opens a template with no position at the 4% the certificate uses, not 50%');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
