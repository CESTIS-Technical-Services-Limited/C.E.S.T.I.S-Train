/* A trainee who has not finished never gets a certificate, and a namesake's
   certificate never moves onto another trainee.

   What happened (Nov 2026): a newly registered trainee, "Steve Barrett" on
   Welding & Fabrication, opened My Certificate and pressed Check for
   Updates. His own record was not in the Centre's backup yet, so the page
   took the record with the same name and programme — a certified trainee —
   merged it into his, and he showed as Certified with that man's number.
   The approvals reconcile then matched the approval to him by name, and he
   could download a certificate for a course he had not finished.

   Pinned here, with the real cestis-core.js and the real functions from
   index.html:
     - CESTISCore.certs.isIssued: only Certified or Collected, with a number,
       not withdrawn;
     - CESTISCore.identityConflict: a different email, TRN or date of birth
       means another person;
     - the same-name collapse and the account link refuse such a namesake;
     - the cloud merge never takes a namesake on a trainee's device, nor when
       the namesake is a separate record in the same list;
     - the trainee's Check for Updates looks for his own id only;
     - the approvals reconcile never certifies anybody, or moves an approval,
       on a name match.

   Run: node tests/cert-namesake.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const J = v => JSON.parse(JSON.stringify(v));

const ROOT = path.join(__dirname, '..');
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

const CERTIFIED = { id: 'STU-real01', name: 'Steve Barrett', course: 'Welding & Fabrication', stage: 'certified', certNo: 'WF-2026-1234-AB',
  certDate: 'March 01, 2026', email: 'sbarrett@mail.test', progress: 90, lastModified: '2026-03-01T10:00:00.000Z' };
const NEWCOMER = { id: 'STU-4obm5c5f38', name: 'Steve Barrett', course: 'Welding & Fabrication', stage: 'training',
  email: 'steve.barrett@student.heartlms.edu.jm', progress: 0, lastModified: '2026-11-06T10:00:00.000Z' };

console.log('A certificate is issued only to a trainee who has finished');
{
  const I = Core.certs.isIssued;
  assert(I({ certNo: 'X', stage: 'certified' }) && I({ certNo: 'X', stage: 'collected' }), 'Certified or Collected, with a number: issued');
  ['training', 'testing', 'interview', 'nyc', 'incomplete', '', undefined].forEach(st =>
    assert(!I({ certNo: 'X', stage: st }), 'a number on a trainee who is ' + (st || 'without a stage') + ': not issued'));
  assert(!I({ stage: 'certified' }), 'Certified with no number: not issued');
  assert(!I({ certNo: 'X', stage: 'certified', certRevokedAt: '2026-10-01T00:00:00Z' }), 'withdrawn: not issued');
}

console.log('Two people with one name');
{
  const C = Core.identityConflict;
  assert(C(CERTIFIED, NEWCOMER), 'different emails: two people');
  assert(C({ trn: '123-456-789' }, { trn: '987654321' }) && !C({ trn: '123-456-789' }, { trn: '123456789' }), 'TRN compared without dashes');
  assert(C({ dob: '2001-05-04' }, { dob: '2002-05-04' }) && !C({ dob: '2001-05-04' }, { dateOfBirth: 'May 4, 2001' }), 'date of birth compared as a date');
  assert(!C({ email: 'A@x.test' }, { email: 'a@x.test ' }), 'one email in two spellings: the same');
  assert(!C({ name: 'A' }, { name: 'A', email: 'a@x.test' }), 'a detail only one side has decides nothing');

  const roll = [J(CERTIFIED), J(NEWCOMER)];
  const r = Core.collapseSameNameStudents(roll);
  assert(r.students.length === 2, 'the same-name collapse keeps both');
  const same = [J(CERTIFIED), Object.assign(J(NEWCOMER), { email: CERTIFIED.email })];
  const r2 = Core.collapseSameNameStudents(same);
  assert(r2.students.length === 1, '(the same person written twice still collapses to one)');

  const link = Core.accountAccess.studentLinkFor({ name: 'Steve Barrett', programme: 'Welding & Fabrication', email: NEWCOMER.email }, [J(CERTIFIED)]);
  assert(!link.match && !link.ambiguous, 'a new account is not linked to a namesake with another email');
  const link2 = Core.accountAccess.studentLinkFor({ name: 'Steve Barrett', programme: 'Welding & Fabrication', email: CERTIFIED.email }, [J(CERTIFIED)]);
  assert(link2.match && link2.match.id === CERTIFIED.id, '(his own account still links to his record)');
}

const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

console.log('The cloud merge never takes a namesake for this trainee');
{
  const sb = { window: {}, CESTISCore: Core, currentRole: 'admin' };
  sb.window.CESTISCore = Core;
  vm.createContext(sb);
  vm.runInContext(extract(SRC, 'cloudNamesakeIsSame'), sb);
  const same = (l, c, ids) => vm.runInContext('cloudNamesakeIsSame(a, b, ids)', Object.assign(sb, { a: l, b: c, ids: ids || {} }));
  assert(!same(NEWCOMER, CERTIFIED), 'different emails: not merged');
  assert(!same(Object.assign(J(NEWCOMER), { email: '' }), CERTIFIED, { 'STU-4obm5c5f38': 1 }), 'this record is a separate record in the same list: not merged');
  assert(same(Object.assign(J(NEWCOMER), { email: '' }), CERTIFIED, { 'STU-real01': 1 }), '(a re-IDed copy with nothing against it, on a staff device: merged as before)');
  sb.currentRole = 'student';
  assert(!same(Object.assign(J(NEWCOMER), { email: '' }), CERTIFIED, {}), 'on a trainee\'s own device: never by name');

  const refresh = extract(SRC, 'studentRefreshCertData');
  assert(/cloudStudents\.find\(function\(cs\) \{ return cs && cs\.id === currentStudent\.id; \}\);/.test(refresh) && refresh.indexOf('sameName') === -1,
    'Check for Updates looks for the trainee\'s own id only');
  const merge = extract(SRC, 'mergeCloudStudents');
  assert(merge.indexOf('cloudNamesakeIsSame(s, cloudStudent, _cloudIds)') !== -1, 'the backup merge asks before taking a namesake');
  const mfc = extract(SRC, 'mergeFromCloud');
  assert(mfc.indexOf('cloudNamesakeIsSame(s, cloudStudent, _mfIds)') !== -1, 'and so does Merge Latest Changes');
}

console.log('The approvals reconcile never certifies anybody by name');
{
  const run = (roll, approvals, role) => {
    const sb = { CESTISCore: Core, students: J(roll), certDownloadApprovals: J(approvals), currentRole: role || 'admin', saved: 0 };
    sb.saveState = () => { sb.saved++; };
    vm.createContext(sb);
    vm.runInContext(['certNumberKey', 'certRememberAlias', '_certApprovalOf', 'certAlignNumberWithApproval', 'reconcileCertifiedFromApprovals'].map(n => extract(SRC, n)).join('\n') + '\nreconcileCertifiedFromApprovals();', sb);
    return sb;
  };
  const appr = { studentId: CERTIFIED.id, name: CERTIFIED.name, course: CERTIFIED.course, certNo: CERTIFIED.certNo, approved: true, approvedDate: '2026-03-02T10:00:00.000Z' };
  // On the newcomer's phone the roll is his own record; the approval names the other man.
  let sb = run([NEWCOMER], [appr], 'student');
  assert(sb.students[0].stage === 'training' && !sb.students[0].certNo, 'on his phone: still in training, no number');
  assert(sb.certDownloadApprovals[0].studentId === CERTIFIED.id, 'and the approval still names the certified trainee');
  sb = run([NEWCOMER], [appr], 'admin');
  assert(sb.students[0].stage === 'training' && sb.certDownloadApprovals[0].studentId === CERTIFIED.id, 'on an office PC: the same');
  // The same certified trainee re-IDed (number and all): the approval still follows him.
  const reIded = Object.assign(J(CERTIFIED), { id: 'STU-real02' });
  sb = run([reIded], [appr], 'admin');
  assert(sb.certDownloadApprovals[0].studentId === 'STU-real02', '(a re-IDed copy of the certified trainee, same number: the approval follows him)');
  // By id: still restores a lost certified stage, as before.
  sb = run([Object.assign(J(CERTIFIED), { stage: 'training', certNo: '' })], [appr], 'admin');
  assert(sb.students[0].stage === 'certified' && sb.students[0].certNo === CERTIFIED.certNo, '(by id: a lost certified stage is restored, as before)');
}

console.log('The trainee\'s page and the portal show a certificate only once issued');
{
  const page = extract(SRC, 'renderStudentCertificate');
  assert(page.indexOf('if(CESTISCore.certs.isIssued(s)){') !== -1, 'My Certificate shows it only once issued');
  const portal = extract(SRC, 'certPortalPreview');
  assert(portal.indexOf('if (!CESTISCore.certs.isIssued(student)) {') !== -1, 'the certificate portal says "not yet issued" for an unfinished trainee');
  const pdf = extract(SRC, 'generateCertificatePDF');
  assert(pdf.indexOf('if(!CESTISCore.certs.isIssued(student))') !== -1, 'and no PDF is made for one, whatever called it');
  const gate = fs.readFileSync(path.join(ROOT, 'trainee-gate', 'Gate.gs'), 'utf8');
  assert(/stu\.stage !== 'certified' && stu\.stage !== 'collected'/.test(extract(gate, 'gateCertTemplate')), 'the gate gives the background only to a finished trainee');
}

console.log((failed ? '✗' : '✓') + ' ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
