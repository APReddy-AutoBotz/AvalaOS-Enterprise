import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PeopleError, ROLES, can, describeAudit, leavesNoAdmin, roleOf, validateEmail } from './roles.ts';

test('every role maps back to itself', () => {
  for (const r of ROLES) assert.equal(roleOf({ access: r.access, canApprove: r.canApprove, job: r.job }).key, r.key);
});

test('only admins manage people and settings', () => {
  for (const r of ROLES) {
    const m = { access: r.access, canApprove: r.canApprove, job: r.job };
    assert.equal(can(m, 'manage_people'), r.key === 'admin', r.key);
    assert.equal(can(m, 'change_settings'), r.key === 'admin', r.key);
  }
});

test('analysts, architects and developers edit; approvers and viewers do not', () => {
  const by = (k: string) => { const r = ROLES.find(x => x.key === k)!; return { access: r.access, canApprove: r.canApprove, job: r.job }; };
  for (const k of ['business_analyst', 'solution_architect', 'developer']) assert.equal(can(by(k), 'edit_process'), true, k);
  for (const k of ['approver', 'viewer']) assert.equal(can(by(k), 'edit_process'), false, k);
  assert.equal(can(by('approver'), 'approve'), true);
  assert.equal(can(by('developer'), 'approve'), false);
  assert.equal(can(by('viewer'), 'read'), true);
});

test('an old editor with no job reads as a business analyst; a hand-set approval flag still reads as approver', () => {
  assert.equal(roleOf({ access: 'editor', canApprove: false, job: null }).key, 'business_analyst');
  assert.equal(roleOf({ access: 'viewer', canApprove: true, job: null }).key, 'approver');
  assert.equal(roleOf({ access: 'editor', canApprove: true, job: 'developer' }).key, 'developer');
});

test('email: trimmed and lower-cased; nonsense refused with a plain message', () => {
  assert.equal(validateEmail('  Priya.Nair@Acme.com '), 'priya.nair@acme.com');
  for (const bad of ['', 'priya', 'a@b', 'a b@c.com']) assert.throws(() => validateEmail(bad), PeopleError);
});

test('the last admin cannot be demoted or removed', () => {
  const ms = [{ userId: 'a', access: 'admin' as const }, { userId: 'b', access: 'editor' as const }];
  assert.equal(leavesNoAdmin(ms, 'a', 'editor'), true);
  assert.equal(leavesNoAdmin(ms, 'a', null), true);
  assert.equal(leavesNoAdmin(ms, 'a', 'admin'), false);
  assert.equal(leavesNoAdmin(ms, 'b', null), false);
  assert.equal(leavesNoAdmin([...ms, { userId: 'c', access: 'admin' }], 'a', null), false);
});

test('audit lines read as sentences', () => {
  assert.equal(describeAudit({ kind: 'invited', actor: 'Asha', subject: 'ravi@acme.com', detail: 'Developer' }), 'Asha invited ravi@acme.com as Developer');
  assert.equal(describeAudit({ kind: 'approved', actor: 'Asha', subject: 'Vendor Invoice Processing', detail: 'version 2' }), 'Asha approved Vendor Invoice Processing (version 2)');
  assert.equal(describeAudit({ kind: 'removed', actor: 'Asha', subject: 'Ravi', detail: '' }), 'Asha removed Ravi');
});
