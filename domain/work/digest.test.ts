import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namedNeeds, needKey, needsDigest, type DigestInput } from './digest.ts';
import type { Person, ProcessFacts } from './home.ts';

const ME = 'u-ana';
const ana: Person = { userId: ME, access: 'editor', canApprove: true, job: 'business_analyst' };
const proc = (id: string, over: Partial<ProcessFacts> = {}): ProcessFacts => ({
  id, name: `Process ${id}`, analystId: ME, architectId: null, approverId: null, status: 'approved', openQuestions: 0, proposalsWaiting: 0, ...over,
});
const base = (over: Partial<DigestInput> = {}): DigestInput => ({
  to: 'Ana@Example.com', name: 'Ana', workspace: 'Finance', organization: 'Acme', needs: [], seen: [], emailOn: true,
  siteUrl: 'https://avalaos.com', unsubscribeUrl: 'https://avalaos.com/unsubscribe?token=t1', ...over,
});

test('only duties a person is named for are emailed; unnamed duties stay on My work', () => {
  const needs = namedNeeds(ana, [
    proc('p1', { openQuestions: 3 }),                       // named analyst
    proc('p2', { analystId: null, openQuestions: 2 }),       // nobody named: My work only
    proc('p3', { approverId: null, status: 'draft' }),       // nobody named as approver: My work only
    proc('p4', { approverId: ME, status: 'changed' }),       // named approver
  ]);
  assert.deepEqual(needs.map(n => [n.processId, n.stage]), [['p1', 'documents'], ['p4', 'process']]);
});

test('an email goes only when something is new since the last run, and lists everything still waiting', () => {
  const needs = namedNeeds(ana, [proc('p1', { openQuestions: 3 }), proc('p4', { approverId: ME, status: 'changed' })]);
  const first = needsDigest(base({ needs }));
  assert.deepEqual(first.fresh, first.keys);
  assert.equal(first.email?.to, 'ana@example.com');
  assert.equal(first.email?.subject, '2 things need you in Finance');
  assert.ok(!first.email?.text.includes('New:'), 'nothing is marked new when everything is');

  // Next day, nothing changed (a count going up is the same need): no email.
  const same = needsDigest(base({ needs: namedNeeds(ana, [proc('p1', { openQuestions: 5 }), proc('p4', { approverId: ME, status: 'changed' })]), seen: first.keys }));
  assert.equal(same.email, null);
  assert.deepEqual(same.fresh, []);

  // Proposals appear on a process where Ana is the architect: one new thing, the rest listed too.
  const more = namedNeeds(ana, [proc('p1', { openQuestions: 3, architectId: ME, proposalsWaiting: 4 }), proc('p4', { approverId: ME, status: 'changed' })]);
  const next = needsDigest(base({ needs: more, seen: first.keys }));
  assert.deepEqual(next.fresh, [needKey({ processId: 'p1', duty: 'architect', stage: 'work-items' })]);
  assert.equal(next.email?.subject, '1 new, 3 in all, need you in Finance');
  assert.match(next.email!.text, /- New: 4 work items waiting to be confirmed to the board\n  https:\/\/avalaos\.com\/process\/p1\/work-items/);
  assert.match(next.email!.text, /- 3 open questions to answer\n/);
  assert.match(next.email!.html, />New</);
});

test('a need that went away and came back counts as new; seen keys follow every run', () => {
  const q = namedNeeds(ana, [proc('p1', { openQuestions: 1 })]);
  const none = needsDigest(base({ needs: [], seen: q.map(needKey) }));
  assert.deepEqual([none.keys, none.email], [[], null]);
  const back = needsDigest(base({ needs: q, seen: none.keys }));
  assert.ok(back.email);
});

test('nothing is sent to a person who stopped these emails, but what they have is still recorded', () => {
  const needs = namedNeeds(ana, [proc('p1', { openQuestions: 1 })]);
  const off = needsDigest(base({ needs, emailOn: false }));
  assert.equal(off.email, null);
  assert.deepEqual(off.keys, needs.map(needKey));
});

test('every email says why it came and links to stop it; names cannot break the email', () => {
  const needs = namedNeeds(ana, [proc('p1', { name: 'Pay <b>suppliers</b>\nnow', openQuestions: 1 })]);
  const d = needsDigest(base({ needs, name: 'Ana\r\nBcc: x@y.z', workspace: 'Fin\nance' }));
  assert.match(d.email!.text, /You get this email on weekdays when something new needs you/);
  assert.match(d.email!.text, /Stop these emails: https:\/\/avalaos\.com\/unsubscribe\?token=t1/);
  assert.match(d.email!.html, /href="https:\/\/avalaos\.com\/unsubscribe\?token=t1"/);
  assert.ok(!d.email!.html.includes('<b>suppliers'), 'process names are escaped');
  assert.ok(!/\r|\n/.test(d.email!.subject), 'one-line subject');
  assert.match(d.email!.text, /^Hello Ana Bcc: x@y\.z,/);
});

test('no valid address: nothing sent and nothing recorded, so the next run tries again', () => {
  const needs = namedNeeds(ana, [proc('p1', { openQuestions: 1 })]);
  const d = needsDigest(base({ needs, to: 'not-an-address', seen: ['old'] }));
  assert.deepEqual([d.email, d.keys], [null, ['old']]);
});
