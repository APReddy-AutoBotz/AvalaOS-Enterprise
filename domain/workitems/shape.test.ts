import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorOf, isUserMade, mergeProblem, mergeProposals, ProposalError, reconcileProposals, splitProposal, type Proposal } from './register.ts';
import type { ProposalDraft } from './derive.ts';

const p = (key: string, more: Partial<Proposal> = {}): Proposal => ({ key, type: 'story', parentKey: 'epic', title: `T ${key}`, description: `D ${key}`, acceptance: [`${key} one`, `${key} two`], stepIds: [`s-${key}`], requirements: [`FR-${key}`], state: 'selected', rejectedReason: null, edited: false, order: 0, ...more });
const draft = (x: Proposal): ProposalDraft => ({ key: x.key, type: x.type, parentKey: x.parentKey, title: x.title, description: x.description, acceptance: x.acceptance, stepIds: x.stepIds, requirements: x.requirements } as ProposalDraft);

test('merge: one item with everything the originals had, the originals set aside with a reason', () => {
  const a = p('a', { order: 1 }), b = p('b', { acceptance: ['a one', 'b two'], order: 2 });
  const out = mergeProposals([a, b], [a, b], 'N');
  const [merged, ...rest] = out;
  assert.equal(merged!.key, 'user:N:a');
  assert.equal(merged!.title, 'T a');
  assert.deepEqual(merged!.acceptance, ['a one', 'a two', 'b two']);
  assert.deepEqual(merged!.requirements, ['FR-a', 'FR-b']);
  assert.deepEqual(merged!.stepIds, ['s-a', 's-b']);
  assert.equal(merged!.description, 'D a\n\nD b');
  assert.equal(merged!.state, 'selected');
  assert.ok(merged!.edited);
  assert.deepEqual(rest.map(r => [r.key, r.state, r.rejectedReason]), [['a', 'rejected', 'Merged into “T a”'], ['b', 'rejected', 'Merged into “T a”']]);
});

test('merge: work under the originals moves under the new item; work already on the board stays', () => {
  const a = p('a'), b = p('b');
  const t1 = p('t1', { type: 'task', parentKey: 'a' }), t2 = p('t2', { type: 'task', parentKey: 'b' }), t3 = p('t3', { type: 'task', parentKey: 'a', state: 'confirmed' }), other = p('x', { type: 'task', parentKey: 'zzz' });
  const out = mergeProposals([a, b], [a, b, t1, t2, t3, other], 'N');
  assert.deepEqual(out.filter(o => o.type === 'task').map(o => [o.key, o.parentKey]), [['t1', 'user:N:a'], ['t2', 'user:N:a']]);
});

test('merge refuses what cannot be one item, in plain words', () => {
  assert.match(mergeProblem([p('a')])!, /at least two/);
  assert.match(mergeProblem([p('a'), p('b', { state: 'confirmed' })])!, /on the board/);
  assert.match(mergeProblem([p('a'), p('b', { state: 'rejected' })])!, /Restore/);
  assert.match(mergeProblem([p('a'), p('b', { type: 'task' })])!, /same kind/);
  assert.match(mergeProblem([p('a'), p('b', { parentKey: 'other' })])!, /same epic/);
  assert.match(mergeProblem([p('a', { type: 'epic' }), p('b', { type: 'epic' })])!, /Epics/);
  assert.equal(mergeProblem([p('a'), p('b')]), null);
  assert.throws(() => mergeProposals([p('a')], [], 'N'), ProposalError);
});

test('split: the original keeps the rest, the new item gets the moved criteria and the same links', () => {
  const a = p('a', { acceptance: ['c1', 'c2', 'c3', 'c4'], order: 3 });
  const [kept, created] = splitProposal(a, { title: ' Second part ', move: [2, 3], extra: [] }, 'N');
  assert.deepEqual(kept!.acceptance, ['c1', 'c2']);
  assert.ok(kept!.edited);
  assert.equal(created!.key, 'user:N:a');
  assert.equal(created!.title, 'Second part');
  assert.deepEqual(created!.acceptance, ['c3', 'c4']);
  assert.deepEqual(created!.requirements, ['FR-a']);
  assert.equal(created!.parentKey, 'epic');
  assert.equal(created!.state, 'proposed');
});

test('split: written criteria count toward the new item; each side must stay testable', () => {
  const a = p('a', { acceptance: ['c1', 'c2', 'c3'] });
  const [, created] = splitProposal(a, { title: 'New', move: [2], extra: ['  Given x, when y, then z  ', ''] }, 'N');
  assert.deepEqual(created!.acceptance, ['c3', 'Given x, when y, then z']);
  assert.throws(() => splitProposal(a, { title: 'New', move: [1, 2], extra: [] }, 'N'), /at least two acceptance criteria on this item/);
  assert.throws(() => splitProposal(a, { title: 'New', move: [2], extra: [] }, 'N'), /new item needs at least two/);
  assert.throws(() => splitProposal(a, { title: ' ', move: [2], extra: ['x'] }, 'N'), /title/);
  assert.throws(() => splitProposal(a, { title: 'New', move: [9], extra: ['x'] }, 'N'), /from the list/);
  assert.throws(() => splitProposal(p('a', { state: 'confirmed' }), { title: 'N', move: [], extra: [] }, 'N'), /board/);
  assert.throws(() => splitProposal(p('a', { type: 'epic' }), { title: 'N', move: [], extra: [] }, 'N'), /epic/);
});

test('deriving again keeps made items next to where they came from, never flags them removed, and keeps the new parent', () => {
  const a = p('a', { state: 'rejected' }), b = p('b', { state: 'rejected' }), c = p('c', { state: 'proposed' });
  const t = p('t', { type: 'task', parentKey: 'a' });
  const merged = mergeProposals([p('a'), p('b')], [p('a'), p('b'), t], 'N');
  const stored = [...merged.filter(m => m.key !== 't'), merged.find(m => m.key === 't')!, c];
  const r = reconcileProposals([draft(a), draft(b), draft(c), draft(t)], stored);
  assert.deepEqual(r.proposals.map(x => x.key), ['a', 'user:N:a', 'b', 'c', 't']);
  const made = r.proposals.find(x => x.key === 'user:N:a')!;
  assert.equal(made.sourceRemoved, false);
  assert.equal(made.needsReview, false);
  assert.equal(r.proposals.find(x => x.key === 't')!.parentKey, 'user:N:a');
  assert.deepEqual(r.proposals.map(x => x.order), [0, 1, 2, 3, 4]);
  assert.ok(isUserMade('user:N:a') && !isUserMade('a'));
  assert.equal(anchorOf('user:N:fr:001:x'), 'fr:001:x');
});
