/* A new training centre takes the previous intake's fee.

   Asked for: "The school fee structure should be updated automatically from
   previous school fee on all new training centre/programmes, unless otherwise
   changed by user."

   Every intake of a programme is priced under its own label ("01. Welding and
   Fabrication", then "02. …"), so each new centre created on the LMS arrived on
   the fee page unpriced: its trainees read "Not Priced" and the same cost had
   to be typed in again. Now:

     1. a new intake is priced from the most recent EARLIER intake of the same
        programme — total and term split — and marked as carried over;
     2. the same programme tolerates case, "&"/"and" and "L2"/"Level 2", but a
        different NVQ level, or a different subject, is never matched;
     3. a fee somebody has set is never touched; deleting or renaming a carried
        fee is remembered, so it is not put back; editing one makes it theirs;
     4. a programme with no earlier priced intake is left unpriced — no fee is
        invented;
     5. trainees the LMS recorded under the plain programme name are priced
        from THEIR intake's fee;
     6. the Set Programme Cost form pre-fills the previous fee, including one
        priced under the older shorthand ("WELDING L2"), for the user to keep
        or change.

   Run: node tests/school-fee-carry-forward.test.js [page] */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const ROOT = path.join(__dirname, '..');
const PAGES = process.argv[2]
  ? [process.argv[2]]
  : [path.join(ROOT, 'School.Fee.html'), path.join(ROOT, 'Offline System', 'School.Fee.html')];
let SRC = '', PAGE = '';

function extractFunction(name) {
  const at = SRC.indexOf('\n        function ' + name + '(');
  if (at < 0) throw new Error(PAGE + ' no longer defines ' + name);
  let depth = 0, i = SRC.indexOf('{', at);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(at, i + 1);
}
function extractConst(name) {
  const m = new RegExp('\\n        const ' + name + ' = [^\\n]*;').exec(SRC);
  if (!m) throw new Error(PAGE + ' no longer defines ' + name);
  return m[0];
}

const SIX = [5000, 5000, 5000, 5000, 5000, 3000, 0, 0, 0];
const FIVE = [8000, 8000, 8000, 6000, 5000, 0, 0, 0, 0];
const centre = (id, name, start, end) => ({ id, centreKey: String(id).padStart(2, '0'), name, startDate: start, endDate: end });

function makePage(opts) {
  const backing = Object.assign({}, opts.store || {});
  const store = {
    getItem: k => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); }
  };
  global.CESTISStore = store;
  const sandbox = {
    feeStructure: JSON.parse(JSON.stringify(opts.fees || {})),
    students: opts.students || [],
    CESTISCore: Core, CESTISStore: store,
    saves: 0, toasts: [],
    console: { log() {}, warn() {}, error() {} },
    Date, Object, Array, String, Math, JSON, parseFloat, parseInt, isNaN, NaN
  };
  sandbox.feeTrainingCentres = () => (opts.centres || []).map(c => Object.assign({}, c));
  sandbox.feeCentresCached = sandbox.feeTrainingCentres;
  sandbox.saveFeeStructure = () => { sandbox.saves++; };
  sandbox.formatCurrency = n => '$' + Number(n).toFixed(2);
  sandbox.feeToast = (m) => sandbox.toasts.push(m);
  vm.createContext(sandbox);
  vm.runInContext([
    extractConst('FEE_CARRY_DECLINED_KEY'), extractConst('_FEE_IDENTITY_STOP'),
    ...['feeNameKey', 'feeKeyFor', 'feeCentreLabel', 'feeProgrammeIdentity', 'feeIntakeBefore',
        'feeCarryDeclined', 'feeDeclineCarry', 'feeCarryForwardIntakeFees', 'feeIntakeFeeKey',
        'feeBackfillTuition', 'feeSuggestedFeeFor'].map(extractFunction)
  ].join('\n\n'), sandbox);
  sandbox._backing = backing;
  return sandbox;
}

function runFor(file) {
  SRC = fs.readFileSync(file, 'utf8');
  PAGE = path.relative(ROOT, file);
  console.log('\n=== ' + PAGE + ' ===');

  /* ---------- 1. A new intake takes the previous one's fee ---------- */
  console.log('A new intake is priced from the one before it');
  let page = makePage({
    centres: [centre(1, 'Welding and Fabrication', '2025-04-01', '2026-03-31'),
              centre(2, 'Welding and Fabrication', '2026-04-01', '2027-03-31')],
    fees: { '01. Welding and Fabrication': { total: 28000, terms: SIX } }
  });
  let carried = page.feeCarryForwardIntakeFees();
  let e = page.feeStructure['02. Welding and Fabrication'];
  assert(!!e, 'intake 02 now has a fee');
  assertEq(e && e.total, 28000, 'the same total as intake 01');
  assertEq(e && JSON.stringify(e.terms), JSON.stringify(SIX), 'and the same term split');
  assertEq(e && e.carriedFrom, '01. Welding and Fabrication', 'marked as carried over from intake 01');
  assertEq(carried.length, 1, 'one intake carried');
  assertEq(page.saves, 1, 'and saved');
  assertEq(page.feeCarryForwardIntakeFees().length, 0, 'a second pass finds nothing to do');

  console.log('The most recent earlier intake wins, and a run of new ones is priced in order');
  page = makePage({
    centres: [centre(4, 'Welding and Fabrication', '2027-04-01', ''),
              centre(1, 'Welding and Fabrication', '2024-04-01', '2025-03-31'),
              centre(3, 'Welding and Fabrication', '2026-04-01', '2027-03-31'),
              centre(2, 'Welding and Fabrication', '2025-04-01', '2026-03-31')],
    fees: { '01. Welding and Fabrication': { total: 20000, terms: SIX },
            '02. Welding and Fabrication': { total: 25000, terms: FIVE } }
  });
  page.feeCarryForwardIntakeFees();
  assertEq(page.feeStructure['03. Welding and Fabrication'].total, 25000, 'intake 03 takes 02’s fee, not 01’s');
  assertEq(page.feeStructure['03. Welding and Fabrication'].carriedFrom, '02. Welding and Fabrication', 'from 02');
  assertEq(page.feeStructure['04. Welding and Fabrication'].total, 25000, 'intake 04 takes it on from 03');

  console.log('Only an EARLIER intake is "previous"');
  page = makePage({
    centres: [centre(1, 'Welding and Fabrication', '2024-04-01', '2025-03-31'),
              centre(2, 'Welding and Fabrication', '2025-04-01', '2026-03-31')],
    fees: { '02. Welding and Fabrication': { total: 25000, terms: FIVE } }
  });
  page.feeCarryForwardIntakeFees();
  assert(!page.feeStructure['01. Welding and Fabrication'], 'an older unpriced intake is not priced from a newer one');

  console.log('Without dates, the intake number decides');
  page = makePage({
    centres: [centre(7, 'Cosmetology Level 2', '', ''), centre(9, 'Cosmetology Level 2', '', '')],
    fees: { '07. Cosmetology Level 2': { total: 38000, terms: FIVE } }
  });
  page.feeCarryForwardIntakeFees();
  assertEq(page.feeStructure['09. Cosmetology Level 2'] && page.feeStructure['09. Cosmetology Level 2'].total, 38000, '09 follows 07');

  /* ---------- 2. Same programme, and only the same programme ---------- */
  console.log('\nSpelling differences are the same programme; a different level or subject is not');
  page = makePage({
    centres: [centre(1, 'Welding & Fabrication L2', '2025-04-01', '2026-03-31'),
              centre(2, 'welding and fabrication level 2', '2026-04-01', ''),
              centre(3, 'Welding and Fabrication Level 3', '2026-04-01', ''),
              centre(4, 'Welding', '2026-04-01', ''),
              centre(5, 'Solar Energy Technology', '2026-04-01', '')],
    fees: { '01. Welding & Fabrication L2': { total: 28000, terms: SIX } }
  });
  page.feeCarryForwardIntakeFees();
  assertEq(page.feeStructure['02. welding and fabrication level 2'] && page.feeStructure['02. welding and fabrication level 2'].total, 28000,
    '"&" vs "and", "L2" vs "Level 2" and case are one programme');
  assert(!page.feeStructure['03. Welding and Fabrication Level 3'], 'Level 3 is not priced from Level 2');
  assert(!page.feeStructure['04. Welding'], '"Welding" is not priced from "Welding & Fabrication"');
  assert(!page.feeStructure['05. Solar Energy Technology'], 'a brand-new programme is left unpriced — no fee is invented');

  /* ---------- 3. Unless the user has changed it ---------- */
  console.log('\nA fee somebody set is never touched');
  page = makePage({
    centres: [centre(1, 'Welding and Fabrication', '2025-04-01', ''), centre(2, 'Welding and Fabrication', '2026-04-01', '')],
    fees: { '01. Welding and Fabrication': { total: 28000, terms: SIX },
            '02. Welding and Fabrication': { total: 31000, terms: FIVE } }
  });
  page.feeCarryForwardIntakeFees();
  assertEq(page.feeStructure['02. Welding and Fabrication'].total, 31000, 'intake 02 keeps its own $31,000');
  assert(!page.feeStructure['02. Welding and Fabrication'].carriedFrom, 'and is not marked as carried');
  assertEq(page.saves, 0, 'nothing is saved');

  console.log('A programme priced by its plain name already covers every intake');
  page = makePage({
    centres: [centre(1, 'Welding and Fabrication', '2025-04-01', ''), centre(2, 'Welding and Fabrication', '2026-04-01', '')],
    fees: { 'Welding and Fabrication': { total: 28000, terms: SIX } }
  });
  page.feeCarryForwardIntakeFees();
  assertEq(Object.keys(page.feeStructure).join('|'), 'Welding and Fabrication', 'no intake label is added beside it');

  console.log('A carried fee the user deletes or renames stays gone');
  page = makePage({
    centres: [centre(1, 'Welding and Fabrication', '2025-04-01', ''), centre(2, 'Welding and Fabrication', '2026-04-01', '')],
    fees: { '01. Welding and Fabrication': { total: 28000, terms: SIX } }
  });
  page.feeCarryForwardIntakeFees();
  delete page.feeStructure['02. Welding and Fabrication'];
  assert(page.feeDeclineCarry('02. Welding and Fabrication'), 'deleting it is remembered');
  page.feeCarryForwardIntakeFees();
  assert(!page.feeStructure['02. Welding and Fabrication'], 'and the carry-over does not put it back');
  assert(/02 welding and fabrication/.test(page._backing.cestiSchoolFeeCarryDeclined || ''),
    'the choice is stored with the fee data (cestiSchoolFeeCarryDeclined), so every device honours it');
  assert(!page.feeDeclineCarry('Some Typed Programme'), 'a name that is no training centre is not recorded');
  const del = extractFunction('deleteFee'), edit = extractFunction('saveFeeEdit');
  assert(/delete feeStructure\[skillArea\];[\s\S]{0,200}feeDeclineCarry\(skillArea\)/.test(del), 'the Delete button records it');
  assert(/delete feeStructure\[editingFeeSkillArea\];[\s\S]{0,40}feeDeclineCarry\(editingFeeSkillArea\)/.test(edit), 'so does renaming the entry');
  assert(/feeStructure\[newName\] = \{ total: fee, terms: terms \};/.test(edit),
    'editing replaces the entry, so an edited fee is the user’s and no longer marked as carried');

  /* ---------- 4. The new intake's trainees are priced ---------- */
  console.log('\nTrainees the LMS recorded under the plain name are priced from their own intake');
  page = makePage({
    centres: [centre(1, 'Welding and Fabrication', '2025-04-01', '2026-03-31'),
              centre(2, 'Welding and Fabrication', '2026-04-01', '2027-03-31')],
    fees: { '01. Welding and Fabrication': { total: 28000, terms: SIX } },
    students: [
      { id: 'A', skillArea: 'Welding and Fabrication', centreKey: '02', needsFeeDetails: true, tuitionFee: 0 },
      { id: 'B', skillArea: 'Welding and Fabrication', enrollmentDate: '2026-05-10', needsFeeDetails: true, tuitionFee: 0 },
      { id: 'C', skillArea: 'Solar Energy Technology', enrollmentDate: '2026-05-10', needsFeeDetails: true, tuitionFee: 0 },
      { id: 'D', skillArea: 'Welding and Fabrication', centreKey: '02', needsFeeDetails: true, tuitionFee: 25000 },
      { id: 'E', skillArea: 'Welding and Fabrication', centreKey: '02', tuitionFee: 0 }
    ]
  });
  page.feeCarryForwardIntakeFees();
  assertEq(page.feeBackfillTuition(), 2, 'two trainees priced');
  const by = id => page.students.find(s => s.id === id);
  assertEq(by('A').tuitionFee, 28000, 'one stamped to intake 02');
  assertEq(by('B').tuitionFee, 28000, 'and one enrolled while intake 02 was running');
  assertEq(by('C').tuitionFee, 0, 'a programme with no fee stays unpriced');
  assertEq(by('D').tuitionFee, 25000, 'a tuition already set is left alone');
  assertEq(by('E').tuitionFee, 0, 'and so is one an admin priced at 0 on purpose');

  /* ---------- 5. Wired in ---------- */
  console.log('\nIt runs when the page opens and when the LMS changes its training centres');
  assert(/collapseFeeIntakes\(\);[^\n]*\n\s*const _feeCarried = feeCarryForwardIntakeFees\(\);[^\n]*\n\s*seedFeeInformation\(\);/.test(SRC),
    'on opening: after the intake clean-up, before trainees are priced');
  assert(/loadFeeStructure\(\);\s*_carried = feeCarryForwardIntakeFees\(\);[\s\S]{0,400}seedFeeInformation\(\)/.test(SRC),
    'on an LMS change: from the stored fees, then the trainees are priced');
  assert(/data\.carriedFrom[\s\S]{0,200}Carried over from/.test(extractFunction('renderFeeStructure')),
    'the Fee Structure table marks a carried fee');

  /* ---------- 6. Pricing a programme by hand starts from the previous fee ---------- */
  console.log('\nThe Set Programme Cost form pre-fills the previous fee');
  page = makePage({
    centres: [centre(1, 'Welding and Fabrication', '2025-04-01', ''), centre(2, 'Welding and Fabrication', '2026-04-01', '')],
    fees: { '01. Welding and Fabrication': { total: 28000, terms: SIX },
            'WELDING L2': { total: 28000, terms: SIX }, 'WELDING L3': { total: 35000, terms: FIVE },
            'ELECTRICAL L2': { total: 26000, terms: SIX }, 'ELECTRICAL INSTALLATION L2': { total: 30000, terms: SIX } }
  });
  let sug = page.feeSuggestedFeeFor('02. Welding and Fabrication');
  assertEq(sug && sug.from, '01. Welding and Fabrication', 'a declined intake is offered its previous intake’s fee');
  sug = page.feeSuggestedFeeFor('Welding and Fabrication Level 2');
  assertEq(sug && sug.from, 'WELDING L2', 'a first labelled intake is offered the older shorthand’s fee');
  sug = page.feeSuggestedFeeFor('Welding and Fabrication Level 3');
  assertEq(sug && sug.entry.total, 35000, 'at its own level');
  assertEq(page.feeSuggestedFeeFor('Electrical Installation and Maintenance L2'), null,
    'two older entries that disagree suggest nothing, rather than guess');
  assertEq(page.feeSuggestedFeeFor('Solar Energy Technology'), null, 'a new subject suggests nothing');
  assertEq(page.feeSuggestedFeeFor('WELDING L3'), null, 'an already-priced programme is not re-suggested');
  const prefill = extractFunction('feePrefillProgrammeCost');
  assert(/dataset\.prefilled === '1'/.test(prefill) && /ours\(feeEl\) && ours\(termsEl\)/.test(prefill),
    'figures the user typed are never replaced by a suggestion');
}

PAGES.forEach(runFor);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
