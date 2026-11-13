import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { updateFact } from '../processModel/patch.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { reconcile } from '../requirements/register.ts';
import { buildPdd } from './pdd.ts';
import { buildFrd } from './frd.ts';
import { buildBrd } from './brd.ts';
import type { DocInput } from './common.ts';
import { changedSections, diffLines } from './changes.ts';
import { deriveProposals } from '../workitems/derive.ts';
import { editProposal, keepMine, reconcileProposals, takeUpdate } from '../workitems/register.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const inputOf = (m: ProcessModel, stored: any[] = []): DocInput => {
  const a = assessProcess(m);
  return { model: m, assessment: a, decisions: emptyDecisions(), sources: [], requirements: reconcile(deriveRequirements(m, a), stored).requirements, revision: { label: 'r', state: 'working', date: 'd' } };
};

test('diff: lines kept, added and removed', () => {
  assert.deepEqual(diffLines(['a', 'b', 'c'], ['a', 'x', 'c']), [{ op: 'same', text: 'a' }, { op: 'del', text: 'b' }, { op: 'add', text: 'x' }, { op: 'same', text: 'c' }]);
});

test('changing a step\'s role flags the PDD steps, the delivery model and the maps, the linked FR and its proposals, and nothing else', () => {
  const step = gold.steps.find(s => s.roleIds.length && gold.roles.some(r => r.id !== s.roleIds[0] && r.inScope))!;
  const other = gold.roles.find(r => r.id !== step.roleIds[0] && r.inScope)!;
  const m2 = updateFact(gold, { target: { kind: 'step', id: step.id, field: 'roleIds' }, value: [other.id] }).model;
  const before = inputOf(gold);
  const after = inputOf(m2, before.requirements);
  const pdd = changedSections(buildPdd(before), buildPdd(after)).map(c => c.title);
  assert.ok(pdd.includes('Detailed As-Is steps'), pdd.join());
  assert.ok(pdd.includes('As-Is process map') && pdd.includes('To-Be process map'), pdd.join());
  for (const t of pdd) assert.ok(/steps|map|Delivery model|Key contacts|Process overview/.test(t), `unexpected: ${t}`);
  // The FRD: the actors and that step's FR only.
  const frd = changedSections(buildFrd(before), buildFrd(after)).map(c => c.title);
  const fr = after.requirements!.find(r => r.key === `step:${step.id}` || r.key === `human:${step.id}`);
  for (const t of frd) assert.ok(/Actors|Human-in-the-loop|Traceability/.test(t) || (fr && t.startsWith(fr.code)) || /Open questions/.test(t), `unexpected FRD change: ${t}`);
  // The BRD does not change for a role move.
  assert.deepEqual(changedSections(buildBrd(before), buildBrd(after)).filter(c => !/stakeholder|Scope|roles/i.test(c.title)).map(c => c.title), []);
  // Proposals: only those about the step change.
  const pb = deriveProposals(before, []).proposals, pa = deriveProposals(after, []).proposals;
  const changed = pa.filter(p => JSON.stringify(p) !== JSON.stringify(pb.find(x => x.key === p.key)));
  for (const p of changed) assert.ok(p.stepIds.includes(step.id), p.key);
});

test('an edited proposal needs review when its derived text changes; keep mine clears it', () => {
  const i = inputOf(gold);
  const d = deriveProposals(i, []).proposals;
  const rows = reconcileProposals(d, []).proposals;
  const first = rows;
  const story = first.find(p => p.type === 'story')!;
  const edited = first.map(p => (p.key === story.key ? editProposal(p, { title: 'Mine', description: p.description, acceptance: p.acceptance }) : keepMine(p)));
  const changedDraft = d.map(p => (p.key === story.key ? { ...p, description: `${p.description}\nNew fact.` } : p));
  const r = reconcileProposals(changedDraft, edited).proposals.find(p => p.key === story.key)!;
  assert.equal(r.title, 'Mine');
  assert.equal(r.needsReview, true);
  assert.match(r.derived!.description, /New fact\./);
  const same = reconcileProposals(d, edited).proposals.find(p => p.key === story.key)!;
  assert.equal(same.needsReview, false);
  // Keep mine: the new text is marked as seen; take update: back to the derived text.
  const kept = reconcileProposals(changedDraft, edited.map(p => (p.key === story.key ? keepMine(r) : p))).proposals.find(p => p.key === story.key)!;
  assert.equal(kept.needsReview, false);
  assert.equal(kept.title, 'Mine');
  const taken = reconcileProposals(changedDraft, edited.map(p => (p.key === story.key ? takeUpdate(r) : p))).proposals.find(p => p.key === story.key)!;
  assert.equal(taken.edited, false);
  assert.match(taken.description, /New fact\./);
});
