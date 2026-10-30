/* Registration from home, through the trainee gate (docs/trainee-gate/DESIGN.md §17).

   The owner decided: "trainees register the account at home, for office
   approval (on registering a folder by trainee name should be generated same
   time and uploaded to drive, trainees must use a google account for
   authentication in order for account to reach system)". Before this, a
   registration made on a trainee's own phone never left the phone (the
   dashboard's form needs the Centre's own sign-in to send it), and trainee
   folders were named with the student ID alone.

   What this pins (the gate's own requests are walked through in
   tests/gate-appsscript-vm.test.js, the staff side in
   tests/gate-publisher.test.js, the whole path in real browsers in
   tests/browser/home-registration.js):
     1  CESTISCore.gate's rules, in both builds: a trainee's folder is named
        "<Full Name> (<student ID>)" and described "cestis-trainee acct=… v=1"
        (+ "registration=pending" / "registration=rejected"); one account id
        per address (any case), worked out with the gate's secret; the
        registration's student ID is the dashboard's own
        (CESTISCore.stableStudentId); the catalogue of programmes; the form's
        checks; the file built and read back; what a staff device does with
        one (added pending once, never over the office's account, never back
        after a deletion, never a second account on an address, a newer
        format held);
     2  the duplicate-account protections treat a home registration as a
        real account: never a backfill stub, a fee-roll stub of the same
        person folds INTO it, no backfill makes a second account beside it,
        Verify Users lists it (a trainee's, so Admin Staff may decide on it);
     3  the client (cestis-gate-client.js) against the REAL PASTE-GATE.gs in
        the simulated Apps Script runtime: the password leaves the device
        only as its check (a fresh salt each time), the registration and the
        folder are made, sent again it is the same one; on the Centre's own
        network registering answers "not available" without asking anything;
     4  the screen words (index.html) name no place.

   Run: node tests/home-registration.test.js */
'use strict';
// What a trainee registering from home now gives about herself (OF-3).
const DETAILS_AT_HOME = { gender: 'Female', dob: '2005-02-14', address: '4 Hope Road, Kingston 6', emergencyName: 'Paulette Barrett', emergencyPhone: '876-555-0145' };
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.error('  ✗ FAIL: ' + m); } }
function eq(a, b, m) { assert(JSON.stringify(a) === JSON.stringify(b), m + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
const ROOT = path.join(__dirname, '..');
const { crypto, pbkdf2 } = require('./gate-fixture.js');
const STORED = 'pbkdf2$210000$' + '0a'.repeat(16) + '$' + '1b'.repeat(32);

/* ---------- 1 + 2. The rules, in both builds ---------- */
[['cestis-core.js', require('../cestis-core.js')], ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(function (pair) {
  const where = pair[0], Core = pair[1], G = Core.gate, R = G.reg, AA = Core.accountAccess;
  console.log('\n[' + where + '] A trainee\'s folder: "<Full Name> (<student ID>)", found by the account in its description');
  const stu = Core.stableStudentId({ name: 'Tameka Richards', course: 'Welding & Fabrication' });
  eq(G.folderName('Tameka Richards', stu), 'Tameka Richards (STU-3wfiayryzq)', 'the owner\'s example, to the letter');
  eq(G.folderName('  Tameka   Richards ', stu), 'Tameka Richards (' + stu + ')', 'spaces tidied');
  eq(G.folderName('Kerry/Ann\\Facey\u0007', 'STU-x'), 'Kerry-Ann-Facey (STU-x)', 'no slashes or control characters in a folder name');
  eq(G.folderName('', 'STU-x'), 'STU-x', 'no name: the student ID alone (as before)');
  eq(G.folderName('A'.repeat(300), 'STU-x').length, 100 + ' (STU-x)'.length, 'a very long name is cut, the student ID kept');
  eq(G.folderDescription('USR-1', ''), 'cestis-trainee acct=USR-1 v=1', 'the description every reader finds a folder by');
  eq(G.folderDescription('USR-1', 'pending'), 'cestis-trainee acct=USR-1 v=1 registration=pending', 'a registration waiting');
  eq(G.folderDescription('USR-1', 'rejected'), 'cestis-trainee acct=USR-1 v=1 registration=rejected', 'a registration turned down');
  eq(G.folderDescription('USR-1', 'other'), 'cestis-trainee acct=USR-1 v=1', 'nothing else is a mark');
  eq([G.folderMark('cestis-trainee acct=USR-1 v=1 registration=pending'), G.folderMark('cestis-trainee acct=USR-1 v=1'), G.folderMark(null)], ['pending', '', ''], 'the mark read back');
  eq(['pending', 'rejected', 'active', 'disabled', undefined].map(s => G.folderMarkFor({ status: s })), ['pending', 'rejected', '', '', ''], 'which accounts carry a mark');

  console.log('[' + where + '] One account id per address, made with the gate\'s secret');
  const id1 = R.accountId('Shantelle.Barrett@mail.test', 'ab'.repeat(32), crypto);
  assert(/^USR-home-[0-9a-f]{20}$/.test(id1), 'a "USR-home-…" id (' + id1 + ')');
  eq(R.accountId(' shantelle.barrett@MAIL.test ', 'ab'.repeat(32), crypto), id1, 'the same address in any case: the same id (so the same registration, never two)');
  assert(R.accountId('shantelle.barrett@mail.test', 'cd'.repeat(32), crypto) !== id1, 'another gate\'s secret: another id (an id cannot be worked out from an address alone)');
  assert(R.accountId('kevaughn@mail.test', 'ab'.repeat(32), crypto) !== id1, 'another address: another id');
  eq([R.fileName(id1), R.isFileName(R.fileName(id1)), R.isFileName('CESTISREG.notes.txt'), R.isFileName('CESTISREG.USR-1.json')], ['CESTISREG.' + id1 + '.json', true, false, false], 'its file name, and only that is one');
  eq(R.studentId('Tameka Richards', 'Welding & Fabrication'), stu, 'the student ID is the dashboard\'s own');
  eq(R.studentId('Ann Lee', '02. Welding & Fabrication'), Core.stableStudentId({ name: 'Ann Lee', course: '02. Welding & Fabrication' }), 'an intake\'s keyed programme too');

  console.log('[' + where + '] The programmes a trainee may register for');
  const cat = R.buildCatalogue(['Welding & Fabrication', 'Cosmetology', 'Cosmetology', ' ', { name: 'Plumbing' }], Date.parse('2026-10-28T12:00:00Z'));
  eq([cat.format, cat.version, cat.programmes], ['cestis-programme-catalogue', 1, [{ name: 'Cosmetology' }, { name: 'Plumbing' }, { name: 'Welding & Fabrication' }]], 'sorted, once each, blanks left out');
  eq(R.buildCatalogue(['Cosmetology'], 1).hash, R.buildCatalogue(['Cosmetology'], 2).hash, 'its hash does not move with the time it was built (no republishing every turn)');
  eq(R.catalogueNames(cat), ['Cosmetology', 'Plumbing', 'Welding & Fabrication'], 'read back');
  eq([R.catalogueNames(null), R.catalogueNames({ format: 'x' }), R.catalogueNames(Object.assign({}, cat, { version: 9 }))], [[], [], []], 'nothing for what is not one, or a newer one');

  console.log('[' + where + '] The form is checked');
  const progs = ['Cosmetology', 'Welding & Fabrication'];
  // Her personal details too (office audit OF-3): gender, date of birth, address and an emergency contact required; TRN and a parent or guardian when she has them.
  const DET = { gender: 'Female', dob: '2005-02-14', trn: '123 456 789', address: '4 Hope Road, Kingston 6', parentName: 'Paulette Barrett', parentPhone: '876-555-0145', emergencyName: 'Paulette Barrett', emergencyPhone: '876-555-0145' };
  const form = over => Object.assign({ name: 'Shantelle  Barrett', programme: 'Cosmetology', phone: '876-555-0101', password: STORED }, DET, over || {});
  eq(R.check(form(), progs), { ok: true, value: { name: 'Shantelle Barrett', programme: 'Cosmetology', phone: '876-555-0101', password: STORED, details: { gender: 'Female', dob: '2005-02-14', trn: '123-456-789', address: '4 Hope Road, Kingston 6', parentName: 'Paulette Barrett', parentPhone: '876-555-0145', emergencyName: 'Paulette Barrett', emergencyPhone: '876-555-0145' } } }, 'a good form');
  [['name', { name: 'Shantelle' }], ['name', { name: 'Mr Barrett' }], ['name', { name: 'Shantelle "Barrett"' }], ['name', { name: 'A'.repeat(81) + ' B' }],
    ['programme', { programme: 'Plumbing' }], ['programme', { programme: '' }], ['phone', { phone: 'call me' }],
    ['password', { password: 'Secret-2026' }], ['password', { password: 'pbkdf2$1000$' + '0a'.repeat(16) + '$' + '1b'.repeat(32) }],
    ['password', { password: 'pbkdf2$210000$0a$' + '1b'.repeat(32) }], ['password', { password: '' }]].forEach(function (c) {
    eq(R.check(form(c[1]), progs).field, c[0], 'refused: ' + JSON.stringify(c[1]).slice(0, 60));
  });
  eq(R.check(form({ phone: '' }), progs).ok, true, 'the phone may be left blank');
  [['gender', { gender: '' }], ['gender', { gender: 'X' }], ['dob', { dob: '' }], ['dob', { dob: '2005-02-30' }], ['dob', { dob: '14/02/2005' }], ['dob', { dob: '2024-01-01' }],
    ['trn', { trn: '12345' }], ['address', { address: '' }], ['address', { address: 'Kgn' }], ['address', { address: '4 <b>Hope</b> Road' }],
    ['parentPhone', { parentPhone: '' }], ['parentName', { parentName: '' }], ['parentPhone', { parentPhone: 'none' }],
    ['emergencyName', { emergencyName: '' }], ['emergencyPhone', { emergencyPhone: '' }], ['emergencyName', { emergencyName: '<script>' }]].forEach(function (c) {
    eq(R.check(form(c[1]), progs).field, c[0], 'refused: ' + JSON.stringify(c[1]));
  });
  eq(R.check(form({ trn: '', parentName: '', parentPhone: '' }), progs).ok, true, 'TRN and a parent or guardian may be left blank');
  eq(R.check(form({ gender: 'male' }), progs).value.details.gender, 'Male', 'gender as every form writes it');

  console.log('[' + where + '] The registration file, and what a staff device does with it');
  const reg = R.build({ acct: id1, email: 'shantelle.barrett@mail.test', value: R.check(form(), progs).value, folder: { id: 'FOLD1', name: 'Shantelle Barrett (STU-x)' }, nowMs: Date.parse('2026-10-28T15:30:00Z') });
  eq(reg.details, { gender: 'Female', dob: '2005-02-14', trn: '123-456-789', address: '4 Hope Road, Kingston 6', parentName: 'Paulette Barrett', parentPhone: '876-555-0145', emergencyName: 'Paulette Barrett', emergencyPhone: '876-555-0145' }, 'the registration file carries her personal details');
  eq(R.read(Object.assign({}, reg, { details: undefined })).reg.accountId, id1, 'a registration without them (an older one) is still read');
  eq([reg.format, reg.accountId, reg.studentId, reg.status, reg.registeredVia, reg.googleVerified, reg.folderId, reg.createdAt],
    ['cestis-registration', id1, Core.stableStudentId({ name: 'Shantelle Barrett', course: 'Cosmetology' }), 'pending', 'home-registration', true, 'FOLD1', '2026-10-28T15:30:00.000Z'], 'what it holds');
  eq(R.read(JSON.stringify(reg)).reg.accountId, id1, 'read back from its text');
  eq([R.read('nope').error, R.read({ format: 'x' }).error, R.read(Object.assign({}, reg, { version: 2 })).error, R.read(Object.assign({}, reg, { password: 'plain' })).error,
    R.read(Object.assign({}, reg, { accountId: 'USR-admin' })).error, R.read(Object.assign({}, reg, { name: 'Solo' })).error],
    ['not-registration', 'not-registration', 'newer-version', 'malformed', 'malformed', 'malformed'], 'and what is not one, or not a good one');
  const office = [{ id: 'USR-a', role: 'admin', username: 'shantelle.barrett', email: 'admin@centre.test' }, { id: 'USR-t', role: 'student', username: 'kemar', email: 'KEMAR@mail.test' }];
  const add = R.importOne(reg, office, [], { dateOf: () => '2026-10-28' });
  eq(add.action, 'add', 'a new registration is added');
  const a = add.account;
  eq([a.id, a.role, a.status, a.name, a.email, a.programme, a.phone, a.password, a.registeredVia, a.googleVerified, a.gateFolderId, a.createdAt, a.updatedAt, a.studentDataId],
    [id1, 'student', 'pending', 'Shantelle Barrett', 'shantelle.barrett@mail.test', 'Cosmetology', '876-555-0101', STORED, 'home-registration', true, 'FOLD1', '2026-10-28', reg.createdAt, undefined],
    'as a PENDING trainee account, its address verified, carrying the folder the gate made (no trainee record until it is approved)');
  eq(a.username, 'shantelle.barrett2', 'with a username nobody holds');
  eq(a.details, { gender: 'Female', dob: '2005-02-14', trn: '123-456-789', address: '4 Hope Road, Kingston 6', parentName: 'Paulette Barrett', parentPhone: '876-555-0145', emergencyName: 'Paulette Barrett', emergencyPhone: '876-555-0145' }, 'her personal details wait on the account, for the office to check');
  eq(R.importOne(Object.assign({}, reg, { details: Object.assign({}, reg.details, { dob: 'soon', trn: 'x' }) }), office, []).account.details.dob, undefined,
    'a bad detail in a file is dropped (the office types it) — never the registration');
  eq(R.importOne(reg, office.concat([a]), []).action, 'have', 'an account of that id already here: left as the office has it');
  eq(R.importOne(reg, office, [id1]), { action: 'skip', reason: 'deleted' }, 'an account the office deleted is never brought back');
  eq(R.importOne(Object.assign({}, reg, { email: 'kemar@MAIL.test' }), office, []), { action: 'skip', reason: 'email-taken' }, 'an address another account has: not a second account');
  eq(R.importOne(Object.assign({}, reg, { version: 2 }), office, []).action, 'hold', 'a newer format is held, not read as anything');
  eq(R.importOne('{', office, []).action, 'skip', 'and rubbish is skipped');
  eq(R.importOne(reg, office, [], {}).account.createdAt, '2026-10-28', 'the day from the file when the page gives none');
  eq(['ok', 'no-password', 'pending', 'rejected', 'disabled'].map(st => R.existing({ st })), ['has-account', 'has-account', 'pending', 'rejected', 'disabled'], 'what an address with an account is told');

  console.log('[' + where + '] The duplicate-account protections treat a home registration as a real account');
  const P = 'Cosmetology', name = 'Shantelle Barrett', sid = Core.stableStudentId({ name, course: P });
  const stub = { id: 'USR-SYNC-' + sid, name, role: 'student', status: 'disabled', password: '', email: '', programme: P, registeredVia: 'fee-system', studentDataId: sid, approvedBy: 'system' };
  assert(!AA.isBackfillStub(a), 'a home registration is never a backfill stub');
  assert(AA.isBackfillStub(stub), '(the fee roll\'s placeholder is one)');
  eq(AA.backfillStubFolds([a, stub]).folds, [{ id: stub.id, into: id1, by: 'name' }], 'the fee roll\'s placeholder of the same person folds INTO the home registration');
  assert(AA.traineeHasAccount([a], { name, programme: P, email: '' }), 'so no backfill makes a second account beside it');
  eq(AA.reviewQueue([a, stub]).map(u => u.id), [id1], 'Verify Users lists the registration (and not the placeholder)');
  assert(!AA.isPrivilegedSelfRegistration(a), 'a trainee\'s registration: Admin Staff may decide on it');
  assert(AA.isPrivilegedSelfRegistration(Object.assign({}, a, { role: 'instructor' })), 'one that came from home asking for anything else is not a one-click approval');
  const r = AA.accountForTrainee([a, { id: 'USR-office', role: 'student', name: 'Shantelle Barrett', programme: P, email: '' }], { name, programme: P, email: a.email }, { skip: x => x === a });
  assert(!!(r.match || r.ambiguous), 'and one beside an office-made account of the same person is flagged in Verify Users');
});

/* ---------- 3. The client against the real gate ---------- */
const Core = require('../cestis-core.js');
const fakes = require('./gate-appsscript-fakes.js');
const GATE_URL = 'https://script.google.com/macros/s/FAKE/exec';
const CLIENT_ID = '302497466088-0b619cqa9qno2c606k4rqp742lebc5o8.apps.googleusercontent.com';
function clientIn(opts) {
  // A browser-shaped window of its own for the client (its own storage and fetch).
  const ls = new Map();
  const win = {
    console: { log() {}, warn() {}, error() {} }, Promise, setTimeout, clearTimeout, setInterval, clearInterval, Date, JSON, Math, URL,
    TextEncoder, TextDecoder, Uint8Array, crypto: nodeCrypto.webcrypto, AbortController,
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k), key: i => [...ls.keys()][i] || null, get length() { return ls.size; } },
    location: { protocol: 'https:', origin: opts.origin || 'https://centre.example', hash: '', pathname: '/index.html', search: '' },
    CESTISCore: Core, requests: []
  };
  win.window = win;
  win.fetch = async (url, init) => {
    win.requests.push(String(url));
    return opts.fetch(String(url), init);
  };
  if (opts.lan) win.CESTISPageCloud = { lan: () => Promise.resolve(true) };
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'cestis-gate-client.js'), 'utf8'), win, { filename: 'cestis-gate-client.js' });
  if (opts.address) win.localStorage.setItem('cestisGateAddress', opts.address);
  return win;
}
(async function () {
  console.log('\nThe client and the real gate: the password leaves the device only as its check; the registration and the folder are made');
  const C = require('./gate-fixture.js').makeCentre(Core);
  const w = fakes.makeWorld({ now: Date.now(), seed: 'home-reg' });
  const main = w.drive.mkdir('root', 'CESTIS Main');
  w.drive.put(main.id, 'CESTIS_ACCOUNTS.json', { version: 1, accounts: C.store.voctrain_users, deletedUserIds: [] });
  w.drive.put(main.id, 'CESTIS_LMS_BACKUP.json', { version: '1.0', data: {} });
  w.load(fs.readFileSync(path.join(ROOT, 'trainee-gate', 'PASTE-GATE.gs'), 'utf8'));
  const h = w.get({ op: 'health' });
  eq([h.ok, h.version], [true, 3], 'the gate (version 3: registration from home, and home study) is set up');
  const cfg = w.drive.json(w.drive.child(main.id, 'CESTIS_GATE.json', 'file').id);
  w.drive.put(cfg.registrationsId, 'catalogue.json', Core.gate.reg.buildCatalogue([C.PROGRAMMES[0].name, C.PROGRAMMES[1].name], Date.now()));
  w.tokeninfo['ya29.shantelle'] = { aud: CLIENT_ID, azp: CLIENT_ID, email: 'shantelle.barrett@mail.test', email_verified: 'true', expires_in: '3599',
    scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid' };
  const sent = [];
  const win = clientIn({ address: GATE_URL, fetch: async (url, init) => {
    if (url.indexOf(GATE_URL) !== 0) throw new TypeError('blocked');
    sent.push(init && init.body ? JSON.parse(init.body) : {});
    const out = init && init.method === 'POST' ? w.post(init.body) : w.get({ op: 'health' });
    return { ok: true, status: 200, text: async () => JSON.stringify(out), json: async () => out };
  } });
  const G2 = win.CESTISGate;
  eq((await G2.catalogue()).programmes, [C.PROGRAMMES[1].name, C.PROGRAMMES[0].name].sort(), 'the catalogue, without signing in');
  const st = await G2.registerStart('ya29.shantelle');
  eq([st.ok, st.state, st.email], [true, 'new', 'shantelle.barrett@mail.test'], 'a new address: the form');
  const res = await G2.registerSubmit(Object.assign({ accessToken: 'ya29.shantelle', name: 'Shantelle Barrett', programme: C.PROGRAMMES[0].name, phone: '', password: 'Shantelle-2026' }, DETAILS_AT_HOME));
  eq([res.ok, res.state], [true, 'submitted'], 'sent: it has reached the office');
  const body = sent.filter(b => b.op === 'register.submit')[0];
  eq([body.gender, body.dob, body.address, body.emergencyName, body.emergencyPhone], ['Female', '2005-02-14', '4 Hope Road, Kingston 6', 'Paulette Barrett', '876-555-0145'], 'her personal details went with the form');
  eq(w.drive.json(w.drive.children(cfg.registrationsId, 'file').filter(f => /^CESTISREG\./.test(f.name))[0].id).details.gender, 'Female', 'and are in the registration the office collects');
  assert(!!body && /^pbkdf2\$210000\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(body.password), 'the password went as the dashboard stores one (PBKDF2, 210 000 rounds, a 16-byte salt)');
  assert(JSON.stringify(sent).indexOf('Shantelle-2026') === -1, 'and the password itself never left the device');
  const p = body.password.split('$');
  eq(p[3], nodeCrypto.pbkdf2Sync('Shantelle-2026', Buffer.from(p[2], 'hex'), 210000, 32, 'sha256').toString('hex'), 'a check the dashboard (and the gate\'s sign-in) can verify');
  const regs = w.drive.children(cfg.registrationsId, 'file').filter(f => /^CESTISREG\./.test(f.name));
  const folders = w.drive.children(cfg.traineesId, 'folder');
  const sid = Core.stableStudentId({ name: 'Shantelle Barrett', course: C.PROGRAMMES[0].name });
  eq([regs.length, folders.map(f => f.name)], [1, ['Shantelle Barrett (' + sid + ')']], 'one registration, and her folder named with her name and student ID');
  const again = await G2.registerSubmit(Object.assign({ accessToken: 'ya29.shantelle', name: 'Shantelle Barrett', programme: C.PROGRAMMES[0].name, phone: '', password: 'Shantelle-2026' }, DETAILS_AT_HOME));
  eq([again.state, again.already, w.drive.children(cfg.registrationsId, 'file').filter(f => /^CESTISREG\./.test(f.name)).length, w.drive.children(cfg.traineesId, 'folder').length],
    ['submitted', true, 1, 1], 'sent again: the same registration, the same folder');
  const body2 = sent.filter(b => b.op === 'register.submit')[1];
  assert(body2 && body2.password.split('$')[2] !== p[2], 'and every time it is worked out with a fresh salt');

  console.log('On the Centre\'s own network: registering from home is not available — and nothing is asked');
  const lanWin = clientIn({ lan: true, origin: 'https://cestis.local:8443', fetch: async (url) => {
    if (/\/_cestis\/gate$/.test(url)) return { ok: true, status: 200, json: async () => ({ ok: true, service: 'cestis-trainee-gate', version: 2, protocol: [1], accepting: true, staffOnly: true }) };
    throw new TypeError('blocked');
  } });
  const L = lanWin.CESTISGate;
  eq((await L.registerStart('ya29.x')).error, 'not-available', 'register.start: not available');
  eq((await L.registerSubmit({ accessToken: 'ya29.x', name: 'A B', programme: 'P', password: 'Pw-12345' })).error, 'not-available', 'register.submit: not available');
  eq((await L.catalogue()).error, 'not-available', 'catalogue: not available');
  eq(lanWin.requests.filter(u => !/\/_cestis\/gate$/.test(u) || false).length, 0, 'and nothing but the one question "is the gate here?" was asked');

  /* ---------- 4. The words on screen ---------- */
  console.log('\nThe screens say what happened and what to do — never where anything is kept');
  const PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const grab = name => { const s = PAGE.indexOf('var ' + name + ' = {'); return vm.runInNewContext('(' + PAGE.slice(s + ('var ' + name + ' = ').length, PAGE.indexOf('};', s) + 1) + ')'); };
  const words = Object.values(grab('GATE_REG_SAY')).concat(Object.values(grab('GATE_REG_FIELD')));
  const PLACE = /\b(clouds?|google|drive|gmail|github|servers?|internet|LAN|wi-?fi|broker|mega\s*data|indexed\s*db|local\s*storage)\b|☁|network/i;
  eq(words.filter(t => PLACE.test(t)), [], 'no registration message names a place');
  assert(/class="register-link gate-register-link" onclick="gateRegisterStart\(\)">New trainee\? Register with your email account</.test(PAGE), 'the trainee card offers "New trainee? Register with your email account"');
  assert(/body\.gate-trainee #studentCard \.today-register-link \{ display:none; \}/.test(PAGE), 'and, with the gate on, not today\'s form');
  const vu = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert(/Registered from home · email account verified/.test(vu), 'Verify Users says a registration came from home, its address verified');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
