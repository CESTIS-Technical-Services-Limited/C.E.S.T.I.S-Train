/* Study kits: one unit's notes and practice test, on every Resources page,
   and learner guides uploaded by the office or the programme's instructor.

   What the owner asked (Nov 2026): study kits like the attached Cluster 2 kit
   for all units, in the Resources page for trainees and teachers; their own
   learner guides added there too ("Upload them myself later").

   Pinned here with the real cestis-core.js, the real study-kits/ files and
   functions from index.html:
     - a kit is checked against its format (study-kits/SCHEMA.md) and its
       unit's exam bank; a practice question too close to an exam question is
       refused; study-kits/index.json is up to date;
     - a trainee sees her programme's kits (her level only when her programme
       names one); an instructor hers; the office all;
     - the kit page and the Resources page agree on where the best grade is
       kept; the kit page shows text, never markup;
     - a learner guide made as a web page opens in a sealed frame (its own
       scripts run, but never with this site's storage), and is never
       re-sorted into another kind of resource.

   Run: node tests/study-kits.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const K = Core.studyKits;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const J = v => JSON.parse(JSON.stringify(v));

const ROOT = path.join(__dirname, '..');
const SAMPLE = require('./fixtures/study-kit-sample.json');
function extract(src, name) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

console.log('1. A kit is checked against its format');
{
  assert(K.checkKit(SAMPLE).ok, 'the sample kit is complete (' + K.checkKit(SAMPLE).problems.join('; ') + ')');
  const bad = (fn, re, msg) => { const k = J(SAMPLE); fn(k); const c = K.checkKit(k); assert(!c.ok && c.problems.some(p => re.test(p)), msg + ' (' + c.problems.join('; ') + ')'); };
  bad(k => { k.questions[0].o.pop(); }, /four options/, 'a question with three options is refused');
  bad(k => { k.questions[1].a = 4; }, /a must be 0, 1, 2 or 3/, 'an answer that is not one of the options is refused');
  bad(k => { k.questions[2].why = ''; }, /no explanation/, 'a question without its explanation is refused');
  bad(k => { k.questions[3].o[1] = k.questions[3].o[0]; }, /twice/, 'the same option twice is refused');
  bad(k => { k.questions[4].c = 'c9'; }, /case c9/, 'a question on a case the kit does not have is refused');
  bad(k => { k.cases.c2 = { title: 'Unused', text: 'Nobody asks about it.' }; }, /No question uses case c2/, 'a case no question uses is refused');
  bad(k => { k.questions = k.questions.slice(0, 10); }, /15 to 40/, 'too few questions is refused');
  bad(k => { k.sections = k.sections.slice(0, 3); }, /5 to 12 sections/, 'too few sections is refused');
  bad(k => { k.sections[1].blocks.push({ html: '<b>x</b>' }); }, /one of p, h, ul/, 'a block of an unknown kind (markup) is refused');
  bad(k => { k.sections[0].blocks[1].table.rows.push(['only one cell']); }, /does not fit its headings/, 'a table row that does not fit its headings is refused');
  bad(k => { k.questions[5].id = k.questions[6].id; }, /Two questions are both/, 'two questions with one id are refused');
  bad(k => { k.format = 'something-else'; }, /format must be/, 'another format is refused');
  const big = K.checkKit(SAMPLE, 'x'.repeat(K.MAX_BYTES + 1));
  assert(!big.ok && /KB/.test(big.problems.join(' ')), 'a file over the size limit is refused');
}

console.log('2. Practice questions are never the exam\'s');
{
  const bank = require('../assessments/welding-fabrication/memfab0111c.json');
  const t1 = bank.theory1.questions;
  const copied = { questions: [{ id: 'P-1', q: t1[0].stem, o: t1[0].options, a: t1[0].answer }] };
  assert(K.overlap(copied, bank).length === 1 && K.overlap(copied, bank)[0].with === t1[0].id, 'an exam question copied word for word is found');
  const reworded = { questions: [{ id: 'P-2', q: t1[3].stem.replace(/\?$/, '') + ' in the workshop?', o: ['a', 'b', 'c', 'd'], a: 0 }] };
  assert(K.overlap(reworded, bank).length === 1, 'an exam question with a few words added is found');
  const essay = bank.theory2.essays[0];
  assert(K.overlap({ questions: [{ id: 'P-3', q: essay.stem, o: ['a', 'b', 'c', 'd'], a: 0 }] }, bank).length === 1, 'an essay question copied as a practice question is found');
  assert(K.overlap(SAMPLE, bank).length === 0, 'questions of its own are not');
}

console.log('3. Every kit in the repository is complete, and the index is up to date');
{
  const tool = require('../tools/build-study-kit-index.js');
  const r = tool.build();
  assert(r.problems.length === 0, 'every kit passes its checks (' + r.problems.slice(0, 5).join(' | ') + ')');
  const now = fs.readFileSync(tool.INDEX, 'utf8');
  assert(now === JSON.stringify(r.index, null, 2) + '\n', 'study-kits/index.json is up to date (run node tools/build-study-kit-index.js)');
  const idx = JSON.parse(now);
  assert(idx.format === 'cestis-study-kits' && Array.isArray(idx.kits), 'the index has its format');
  idx.kits.forEach(e => {
    assert(K.safeFile(e.file) && fs.existsSync(path.join(ROOT, 'assessments', e.file)), e.file + ': a kit for a unit with an exam bank');
  });
  assert(K.safeFile('welding-fabrication/memfab0111c.json') && !K.safeFile('../cestis-core.js') && !K.safeFile('https://x.test/a.json') && !K.safeFile('a/b/c.json'), 'only a kit\'s own file name is ever opened');
  assert(K.pageUrl('welding-fabrication/memfab0111c.json', { view: 'test' }) === 'study-kits/kit.html?u=welding-fabrication%2Fmemfab0111c.json#test', 'the kit page address');
  assert(K.pageUrl('../x.json') === null, 'and none for anything else');
}

console.log('4. Each person sees the kits for their programme');
{
  const cats = Core.Transcript.ensureSeeded([]);
  const index = { kits: [
    { file: 'welding-fabrication/memfab0111c.json', programme: 'Welding & Fabrication', qualId: 'QUAL-WEL-L2', qualTitle: 'WELDING LEVEL 2', qualCode: 'MEM22423', level: 2, unitCode: 'MEMFAB0111C', unitTitle: 'Perform basic welding using manual metal arc welding process (MMAW)', status: 'to-check', questions: 20 },
    { file: 'cosmetology/csbcos0031c.json', programme: 'Cosmetology', qualId: 'QUAL-COS-L2', qualTitle: 'COSMETOLOGY LEVEL 2', qualCode: 'CSB21323', level: 2, unitCode: 'CSBCOS0031C', unitTitle: 'Perform shampooing and conditioning services', status: 'to-check', questions: 20 }
  ] };
  const norm = Core.assessments.normTitle;
  const sameProgramme = (a, b) => { const x = norm(a).replace(/ level \d+$/, ''), y = norm(b).replace(/ level \d+$/, ''); return !!x && !!y && (x === y || x.indexOf(y) !== -1 || y.indexOf(x) !== -1); };
  const withKits = progs => progs.map(p => ({ q: p.qual.id, n: p.units.filter(u => u.kit).length, of: p.units.length }));
  const w = withKits(K.forCourse(index, cats, 'Welding & Fabrication', sameProgramme));
  assert(w.length === 2 && w.find(p => p.q === 'QUAL-WEL-L2').n === 1 && w.find(p => p.q === 'QUAL-WEL-L3').n === 0, 'a Welding trainee (no level named): both Welding qualifications, the MMAW kit in Level 2 (' + JSON.stringify(w) + ')');
  const w2 = withKits(K.forCourse(index, cats, 'Welding and Fabrication Level 2', sameProgramme));
  assert(w2.length === 1 && w2[0].q === 'QUAL-WEL-L2' && w2[0].of === 46, 'her programme names Level 2: Level 2 only, every unit listed (' + JSON.stringify(w2) + ')');
  const c = withKits(K.forCourse(index, cats, 'Cosmetology', sameProgramme));
  assert(c.length === 1 && c[0].q === 'QUAL-COS-L2' && c[0].n === 1, 'a Cosmetology trainee: her kit, not Welding\'s');
  const all = withKits(K.forCourse(index, cats, '', null));
  assert(all.length === cats.length && all.reduce((a, p) => a + p.n, 0) === 2, 'the office: every programme, every kit');
  const fb = K.forCourse(index, [], 'Welding & Fabrication', null);
  assert(fb.length === 1 && fb[0].units.length === 1 && fb[0].units[0].kit.file === 'welding-fabrication/memfab0111c.json', 'with no Qualification Plan on the device: the kits\' own programme still finds them');
  assert(K.levelOf('Electrical Installation Level 3') === 3 && K.levelOf('Welding L2') === 2 && K.levelOf('Hospitality & Tourism') === null, 'the level a programme name carries');
}

console.log('5. The kit page and the Resources page agree; the kit page shows text, never markup');
{
  const page = fs.readFileSync(path.join(ROOT, 'study-kits', 'kit.html'), 'utf8');
  assert(page.indexOf("BEST_PREFIX='" + K.BEST_PREFIX + "'") !== -1, 'the best grade is kept where the Resources page reads it (' + K.BEST_PREFIX + ')');
  assert(page.indexOf("/^[a-z0-9-]+\\/[a-z0-9]+\\.json$/") !== -1, 'the page opens only a kit\'s own file name');
  assert(page.indexOf('PASS=' + K.PASS) !== -1, 'the same pass mark (' + K.PASS + '%)');
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)[1];
  const fnSrc = n => { const m = new RegExp('function ' + n + '\\(').exec(script); let d = 0; for (let i = script.indexOf('{', m.index); ; i++) { if (script[i] === '{') d++; else if (script[i] === '}') { d--; if (!d) return script.slice(m.index, i + 1); } } };
  const sb = {}; vm.createContext(sb);
  vm.runInContext(['esc', 'inl', 'plain'].map(fnSrc).join('\n'), sb);
  assert(sb.inl('<img src=x onerror=alert(1)> **Safety** & "care"') === '&lt;img src=x onerror=alert(1)&gt; <strong>Safety</strong> &amp; &quot;care&quot;', 'text is escaped; only **bold** becomes bold');
  assert(sb.plain('**Arc** length') === 'Arc length', 'the shared results text has no stars');
  assert(/lsGet\('cestisTheme'\)==='light'/.test(page), 'light or dark as the dashboard on the device is set');
  // Every resource page has its place for the kits.
  [['Pages/Student-Resources.html', 'sResStudyKits'], ['Pages/Instructor-Resources.html', 'iStudyKits'], ['Pages/Resource-Manager.html', 'arStudyKits'], ['Pages/AdminStaff-Resources.html', 'asStudyKits']].forEach(([f, id]) =>
    assert(fs.readFileSync(path.join(ROOT, f), 'utf8').indexOf('id="' + id + '"') !== -1, f + ' lists the study kits'));
}

const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
console.log('6. A learner guide made as a web page is sealed in its frame');
{
  const viewer = extract(SRC, 'cestisViewerOpen');
  const sandbox = /f\.setAttribute\('sandbox', '([^']*)'\)/.exec(viewer);
  assert(sandbox && /allow-scripts/.test(sandbox[1]) && !/allow-same-origin/.test(sandbox[1]) && !/allow-top-navigation/.test(sandbox[1]), 'its scripts run, but never with this site\'s storage, and it cannot take over the page (' + (sandbox && sandbox[1]) + ')');
  assert(/f\.srcdoc = String\(o\.html\)/.test(viewer) && /tab\.hidden = !o\.src/.test(viewer), 'shown from its text, with no "new tab" (a new tab would not be sealed)');
  const open = extract(SRC, 'openLearnerGuide');
  assert(open.indexOf('learnerGuideIsPage(r)') !== -1 && open.indexOf("window.open(u, '_blank', 'noopener')") !== -1, 'a PDF, Word or PowerPoint guide opens like any other resource');
  const text = extract(SRC, 'learnerGuideText');
  assert(text.indexOf('CESTISGate.fileGet(id)') !== -1 && text.indexOf('googleAccessToken') !== -1 && text.indexOf('caches.open(GUIDE_CACHE)') !== -1, 'fetched through the gate at home, with the Centre\'s sign-in at the office, and kept on the device');

  const sb = { driveResources: [], saveState: () => { sb.saved++; }, saved: 0, console };
  vm.createContext(sb);
  vm.runInContext(extract(SRC, 'recategorizeDriveResources') + '\n' + extract(SRC, 'learnerGuideIsPage'), sb);
  sb.driveResources.push({ id: 'G1', category: 'learner-guide', name: 'Worksheet answers guide', driveFileName: 'VT-AB12-CD34_Worksheet_guide.html', format: 'HTML' });
  vm.runInContext('recategorizeDriveResources()', sb);
  assert(sb.driveResources[0].category === 'learner-guide', 'a learner guide named "Worksheet …" stays a learner guide');
  assert(vm.runInContext('learnerGuideIsPage(driveResources[0])', sb) === true, 'and is known as a web page');
  assert(vm.runInContext("learnerGuideIsPage({ format: 'PDF', driveFileName: 'x.pdf' })", sb) === false, '(a PDF is not)');

  const up = extract(SRC, 'uploadResourceToDrive');
  assert(/unitCode: _unitCode \|\| ''/.test(up) && /A web page \(HTML\) can be uploaded as a Learner Guide/.test(up) && /5 \* 1024 \* 1024/.test(up), 'Upload Resource keeps the guide\'s unit; a web page only as a Learner Guide, up to 5 MB');
  assert(/<option value="learner-guide">Learner Guide<\/option>/.test(SRC) && /id="driveResUnit"/.test(SRC) && /\.html,\.htm"/.test(SRC), 'the form offers Learner Guide, its unit, and web pages');
}

console.log((failed ? '✗' : '✓') + ' ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
