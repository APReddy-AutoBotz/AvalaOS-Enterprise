import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { emptyModel } from '../processModel/empty.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { reconcile } from '../requirements/register.ts';
import { buildBrd } from '../docs/brd.ts';
import { buildPdd } from '../docs/pdd.ts';
import { buildFrd } from '../docs/frd.ts';
import { buildSdd } from '../docs/sdd.ts';
import type { DocInput } from '../docs/common.ts';
import { coverage, deriveProposals, MIN_CRITERIA } from './derive.ts';
import { editProposal, ProposalError, reconcileProposals, rejectProposal, setSelected } from './register.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const inputOf = (m: ProcessModel): DocInput => {
  const a = assessProcess(m);
  return { model: m, assessment: a, decisions: emptyDecisions(), sources: [], requirements: reconcile(deriveRequirements(m, a), []).requirements, revision: { label: 'r', state: 'approved', date: 'd' } };
};
const headingsOf = (i: DocInput) => [buildBrd(i), buildPdd(i), buildFrd(i), buildSdd(i)].flatMap(d => d.sections.map(s => s.title));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

test('AP case: no title equals a document heading; every item has two criteria and a link; every story links an FR', () => {
  const i = inputOf(gold);
  const headings = headingsOf(i);
  const d = deriveProposals(i, headings);
  assert.ok(d.proposals.length > 5);
  const banned = new Set(headings.map(norm));
  for (const p of d.proposals) {
    assert.ok(!banned.has(norm(p.title)), p.title);
    assert.ok(p.acceptance.length >= MIN_CRITERIA, p.title);
    assert.ok(p.requirements.length || p.stepIds.length, p.title);
  }
  for (const s of d.proposals.filter(p => p.type === 'story')) assert.match(s.requirements[0], /^FR-\d{3}$/);
  assert.ok(d.proposals.some(p => p.type === 'epic'));
  assert.ok(d.proposals.some(p => p.type === 'task' && /access to SAP/.test(p.title)));
  // Every FR is covered by a story or listed as not planned with a reason.
  const frs = i.requirements!.filter(r => r.kind === 'FR' && r.state === 'active').map(r => r.code);
  const cov = coverage(d, i.requirements!);
  for (const c of frs) assert.ok(cov.covered.includes(c) || cov.notPlanned.some(n => n.code === c && n.reason), c);
  // Keys are unique; children point to proposals that exist.
  const keys = new Set(d.proposals.map(p => p.key));
  assert.equal(keys.size, d.proposals.length);
  for (const p of d.proposals) if (p.parentKey) assert.ok(keys.has(p.parentKey), p.key);
});

test('a title that would equal a heading is changed, never proposed as is', () => {
  const m: ProcessModel = structuredClone(gold);
  const i0 = inputOf(m);
  const story = deriveProposals(i0, headingsOf(i0)).proposals.find(p => p.type === 'story')!;
  const d = deriveProposals(i0, [...headingsOf(i0), story.title]);
  assert.ok(!d.proposals.some(p => norm(p.title) === norm(story.title)));
  assert.ok(d.proposals.some(p => p.title === `Deliver: ${story.title}`));
});

test('an empty model proposes nothing', () => {
  const i = inputOf(emptyModel('Claims intake'));
  assert.deepEqual(deriveProposals(i, headingsOf(i)).proposals, []);
});

test('edits, selections and rejections survive deriving again; removed sources are flagged, not deleted', () => {
  const i = inputOf(gold);
  const d = deriveProposals(i, headingsOf(i));
  const first = reconcileProposals(d.proposals, []);
  assert.equal(first.changed.length, d.proposals.length);
  const [a, b, c] = first.proposals.filter(p => p.type === 'story');
  const edited = editProposal(a, { title: 'Post invoices automatically', description: 'Mine', acceptance: ['One', 'Two'] });
  const stored = first.proposals.map(p => p.key === a.key ? setSelected(edited, true) : p.key === b.key ? rejectProposal(b, 'Done by the vendor portal') : p);
  const again = reconcileProposals(d.proposals, stored);
  assert.equal(again.changed.length, 0);
  const a2 = again.proposals.find(p => p.key === a.key)!;
  assert.equal(a2.title, 'Post invoices automatically');
  assert.equal(a2.state, 'selected');
  assert.equal(again.proposals.find(p => p.key === b.key)!.rejectedReason, 'Done by the vendor portal');
  const gone = reconcileProposals(d.proposals.filter(p => p.key !== c.key), stored);
  assert.equal(gone.proposals.find(p => p.key === c.key)!.sourceRemoved, true);
  assert.throws(() => editProposal(a, { title: 'x', description: '', acceptance: ['only one'] }), ProposalError);
  assert.throws(() => rejectProposal(a, ' '), ProposalError);
});
