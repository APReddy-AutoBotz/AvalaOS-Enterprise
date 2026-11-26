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

const item = (id: string, over: Partial<import('./digest.ts').AssignedItem> = {}) => ({ id, title: `Item ${id}`, type: 'story', projectId: 'pr1', project: 'Website', assignedBy: 'Ben Iyer', ...over });

test('work someone else gave a person on the board is emailed once, with who gave it and a link', async () => {
  const { itemKey } = await import('./digest.ts');
  const first = needsDigest(base({ assigned: [item('i1', { title: 'Pay by card' })] }));
  assert.equal(first.email?.subject, 'Ben Iyer assigned you "Pay by card" in Finance');
  assert.match(first.email!.text, /Here is new work given to you in Finance \(Acme\) on Avala OS\./);
  assert.match(first.email!.text, /Assigned to you on the board\n- Pay by card \(Story in Website\), from Ben Iyer\n  https:\/\/avalaos\.com\/board\/pr1\/i1/);
  assert.match(first.email!.html, /href="https:\/\/avalaos\.com\/board\/pr1\/i1"/);
  assert.deepEqual(first.keys, [itemKey({ id: 'i1' })]);
  // Still open the next day: not again.
  assert.equal(needsDigest(base({ assigned: [item('i1')], seen: first.keys })).email, null);
  // A second item comes: only the new one is listed.
  const next = needsDigest(base({ assigned: [item('i1'), item('i2'), item('i3', { assignedBy: '' })], seen: first.keys }));
  assert.equal(next.email?.subject, '2 board items were assigned to you in Finance');
  assert.ok(!next.email!.text.includes('Item i1'));
  assert.match(next.email!.text, /- Item i3 \(Story in Website\)\n/);
});

test('new assignments ride along with process needs; a long list is cut with a count', () => {
  const needs = namedNeeds(ana, [proc('p1', { openQuestions: 3 })]);
  const d = needsDigest(base({ needs, assigned: Array.from({ length: 12 }, (_, n) => item(`i${n}`)) }));
  assert.equal(d.email?.subject, 'Something needs you in Finance · 12 assigned to you');
  assert.match(d.email!.text, /- and 2 more on My work/);
  assert.equal((d.email!.text.match(/\(Story in Website\)/g) ?? []).length, 10);
  // The needs were seen already; only an assignment is new: the subject says so, nothing is marked "New".
  const later = needsDigest(base({ needs, assigned: [item('x')], seen: namedNeeds(ana, [proc('p1', { openQuestions: 3 })]).map(needKey) }));
  assert.equal(later.email?.subject, 'Ben Iyer assigned you "Item x" in Finance');
  assert.ok(!later.email!.text.includes('New:'));
  assert.match(later.email!.text, /- 3 open questions to answer/);
});

// ---- Package 5 of docs/next-plan.md: the count My work shows, and review comments --------------------

import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { triage } from '../questions/triage.ts';
import { planQuestions } from '../questions/firstList.ts';
import { foundFor, foundKeys } from '../assistant/sourceLook.ts';
import { commentKey, commentLines, COMMENTS_SHOWN, digestFacts, type CommentLine } from './digest.ts';
import { commentNeeds, needsFor, type OpenComment } from './home.ts';
import { assessmentLine } from '../questions/result.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const servicenow = 'system:sys-servicenow';
const found = {
  key: `answer:${servicenow}:Its REST API can be used`, kind: 'answer' as const, title: 't', why: 'w', quote: { text: 'q', source: 's' }, willDo: 'd', needs: 'edit_process' as const,
  target: { kind: 'answer' as const, itemKey: servicenow, source: 's', proposal: { itemKey: servicenow, question: 'q', display: 'Its REST API can be used', quote: 'q', certainty: 'stated' as const, answer: { statuses: { 0: 'confirmed' as const } } } },
};
const look = { sources: 'a', looked: [servicenow], found: [found], questions: 1, passages: 1, tokens: 1, calls: 1 };

test('the email counts the questions as My work does: the first list, from the same model and the same look', () => {
  const m = gold();
  // What My work counts (journey/processFacts.ts, through the shared look).
  const t = triage(m, assessProcess(m));
  const plan = planQuestions(t, m, { found: foundKeys(foundFor(look, t, [])) });
  const screen = { now: plan.now.length, found: plan.found.length, wait: plan.wait.length };
  // The office scanner's question, a device's, is Detail and waits (owner, 24 November 2026).
  assert.deepEqual(screen, { now: 1, found: 1, wait: 10 });
  // What the email works out on the server from needs_digest_input().
  const row = { ...proc('p1', { openQuestions: m.openQuestions.filter(q => q.status === 'open').length }), model: m, look, dismissed: [] };
  const facts = digestFacts(row);
  assert.deepEqual(facts.questions, screen);
  assert.ok(!('model' in facts) && !('look' in facts), 'the model and the look are not kept');
  const lines = namedNeeds(ana, [facts]).map(n => n.text);
  assert.deepEqual(lines, ['1 question only your people can answer', '1 answer found in the sources to confirm']);
  assert.deepEqual(lines, needsFor(ana, [{ ...proc('p1'), questions: screen }]).map(n => n.text));
  // "Not right" on the answer, shared: the question goes back to the people, as on the screen.
  assert.deepEqual(digestFacts({ ...row, dismissed: [found.key] }).questions, { now: 2, found: 0, wait: 10 });
  // Only "can wait" questions: not a need, as on My work.
  assert.deepEqual(namedNeeds(ana, [{ ...proc('p2'), questions: { now: 0, found: 0, wait: 4 } }]), []);
  // A process with no steps, or a model that cannot be read, keeps the stored count.
  assert.equal(digestFacts({ ...proc('p3', { openQuestions: 2 }), model: null }).questions, undefined);
  assert.equal(digestFacts({ ...proc('p3', { openQuestions: 2 }), model: { steps: 'broken' } as never }).questions, undefined);
});

test('package 16 changes nothing the email counts: the demo\'s sample and the bare sample, beside the Assessment stage\'s line', () => {
  // The demo's approved revision (public/demo-data/sample.json) and the hand-checked sample, with no look.
  const demo = (JSON.parse(readFileSync(new URL('../../public/demo-data/sample.json', import.meta.url), 'utf8')) as { revisions: { state: string; model: ProcessModel }[] })
    .revisions.find(r => r.state === 'approved')!.model;
  const counts = (m: ProcessModel) => digestFacts({ ...proc('p1'), model: m, look: null, dismissed: [] }).questions;
  assert.deepEqual(counts(demo), { now: 2, found: 0, wait: 10 });
  assert.deepEqual(counts(gold()), { now: 2, found: 0, wait: 10 });
  // The line counts a different thing (questions that could change the recommendation, not left with someone), from the same triage.
  assert.equal(assessmentLine(demo, assessProcess(demo))!.n, 2);
  assert.equal(assessmentLine(gold(), assessProcess(gold()))!.n, 2);
});

const comment = (id: string, over: Partial<OpenComment & { processId: string }> = {}): OpenComment & { processId: string } => ({
  id, processId: 'p1', docType: 'pdd', sectionKey: 's-2-4', sectionTitle: 'Detailed As-Is steps', authorId: 'u-ben', author: 'Ben Iyer', createdAt: `2026-11-16T0${id.length}:00:00Z`, ...over,
});

test('a review comment reaches the people named on the process, never its author, once, with the document, section, who and a link', () => {
  const processes = [proc('p1', { architectId: 'u-cy' }), proc('p2', { analystId: 'u-other' })];
  const comments = [comment('c1'), comment('c2', { authorId: ME, author: 'Ana' }), comment('c3', { processId: 'p2' })];
  // Ana is named on p1 only; her own comment is not hers to read.
  const mine = commentLines(ME, processes, comments);
  assert.deepEqual(mine.map(c => c.id), ['c1']);
  // Cy, the architect, gets Ana's and Ben's.
  assert.deepEqual(commentLines('u-cy', processes, comments).map(c => c.id), ['c1', 'c2']);
  // An email can go for comments alone.
  const d = needsDigest(base({ comments: mine }));
  assert.equal(d.email?.subject, 'Ben Iyer commented on the PDD of Process p1');
  assert.match(d.email!.text, /New review comments\n- PDD of Process p1, "Detailed As-Is steps", from Ben Iyer\n {2}https:\/\/avalaos\.com\/process\/p1\/documents\?doc=pdd#s-2-4/);
  assert.match(d.email!.html, /href="https:\/\/avalaos\.com\/process\/p1\/documents\?doc=pdd#s-2-4"/);
  assert.doesNotMatch(d.email!.text.split('Stop these emails')[0]!, /@/, 'no email address in the body');
  assert.deepEqual(d.keys, [commentKey({ id: 'c1' })]);
  // Seen in that email: not listed again, and no email for it alone.
  assert.equal(needsDigest(base({ comments: mine, seen: d.keys })).email, null);
  // Resolved: the server no longer lists it, so it is not in the email and drops out of what was seen.
  const after = needsDigest(base({ comments: [], seen: d.keys }));
  assert.equal(after.email, null);
  assert.deepEqual(after.keys, []);
});

test('new comments ride along with process needs; a long list is cut with a count; My work shows the same people the same comments', () => {
  const many: CommentLine[] = Array.from({ length: COMMENTS_SHOWN + 3 }, (_, i) => ({ ...comment(`c${i}`), processName: 'Process p1' }));
  const needs = namedNeeds(ana, [proc('p1', { openQuestions: 2 })]);
  const d = needsDigest(base({ needs, comments: many }));
  assert.equal(d.email?.subject, `Something needs you in Finance · ${COMMENTS_SHOWN + 3} new comments`);
  assert.equal((d.email!.text.match(/^- PDD of Process p1/gm) ?? []).length, COMMENTS_SHOWN);
  assert.match(d.email!.text, /- and 3 more on My work/);
  // My work: one line per process for the people named on it, never for the author, opening the documents.
  const facts = [proc('p1', { comments: [comment('c1'), comment('c2', { authorId: ME })] }), proc('p2', { analystId: 'u-other', comments: [comment('c3', { processId: 'p2' })] }), proc('p3', { comments: [comment('c4', { authorId: ME })] })];
  const lines = commentNeeds(ana, facts);
  assert.deepEqual(lines.map(n => [n.processId, n.text, n.stage, n.kind]), [['p1', '1 open review comment on the documents', 'documents', 'comments']]);
  assert.deepEqual(commentLines(ME, facts, facts.flatMap(p => (p.comments ?? []).map(c => ({ ...c, processId: p.id })))).map(c => c.id), ['c1']);
});

test('the links for questions carry the marker that opens Closing the gaps; the others and what counts as new do not change', () => {
  const needs = namedNeeds(ana, [
    proc('p1', { questions: { now: 2, found: 1, wait: 4 }, architectId: ME, proposalsWaiting: 3 }),
    proc('p2', { openQuestions: 3 }),
    proc('p4', { approverId: ME, status: 'changed' }),
  ]);
  const d = needsDigest(base({ needs }));
  const text = d.email!.text;
  assert.match(text, /- (New: )?2 questions only your people can answer\n  https:\/\/avalaos\.com\/process\/p1\/documents\?gaps=all\n/);
  assert.match(text, /- (New: )?1 answer found in the sources to confirm\n  https:\/\/avalaos\.com\/process\/p1\/documents\?gaps=all\n/);
  assert.match(text, /- (New: )?3 open questions to answer\n  https:\/\/avalaos\.com\/process\/p2\/documents\?gaps=all\n/);
  assert.match(text, /- (New: )?3 work items waiting to be confirmed to the board\n  https:\/\/avalaos\.com\/process\/p1\/work-items\n/);
  assert.match(text, /\n  https:\/\/avalaos\.com\/process\/p4\/process\n/);
  assert.equal((d.email!.html.match(/\/documents\?gaps=all"/g) ?? []).length, 3);
  assert.ok(!/(work-items|\/process)\?gaps/.test(d.email!.html));
  assert.deepEqual(d.keys, ['p1:analyst:documents', 'p1:architect:work-items', 'p2:analyst:documents', 'p4:approver:process'], 'the keys are as before');
});
