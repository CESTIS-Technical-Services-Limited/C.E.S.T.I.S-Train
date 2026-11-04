/* Copy shared units' banks into each other qualification that uses them as core,
   with that qualification's own programme, id, title, code, level and unit title. */
'use strict';
const fs = require('fs'), path = require('path');
const Core = require(path.join(__dirname, '..', '..', 'cestis-core.js'));
const B = JSON.parse(fs.readFileSync(path.join(__dirname, 'batches.json'), 'utf8'));
const W = JSON.parse(fs.readFileSync(path.join(__dirname, 'worklist-l2-core.json'), 'utf8'));
const quals = {}; W.quals.forEach(q => { quals[q.id] = q; });
const titleOf = {}; Core.Transcript.seedCatalogs().forEach(q => (q.units || []).forEach(u => { titleOf[q.id + '|' + u.code] = u.name; }));
const onlyHome = process.argv[2];   // e.g. QUAL-WEL-L2
let n = 0;
B.batches.filter(b => !onlyHome || b.home === onlyHome).forEach(b => b.units.forEach(u => {
  const src = path.join(__dirname, 'out', b.folder, u.code.toLowerCase() + '.json');
  if (!fs.existsSync(src)) return;
  (u.alsoIn || []).forEach(qid => {
    const q = quals[qid], folder = B.slug[qid];
    const bank = JSON.parse(fs.readFileSync(src, 'utf8'));
    bank.programme = q.skillArea; bank.qualification = { id: q.id, title: q.title, code: q.code }; bank.level = q.level;
    bank.unit = { code: u.code, title: titleOf[qid + '|' + u.code] || u.title };
    const dir = path.join(__dirname, 'out', folder); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, u.code.toLowerCase() + '.json'), JSON.stringify(bank, null, 2) + '\n');
    n++;
  });
}));
console.log(n + ' shared copies written');
