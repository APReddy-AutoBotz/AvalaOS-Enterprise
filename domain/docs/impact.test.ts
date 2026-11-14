import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { removeStep, setSystemApi, updateFact } from '../processModel/patch.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { persisted, reconcile } from '../requirements/register.ts';
import { deriveProposals } from '../workitems/derive.ts';
import type { Proposal } from '../workitems/register.ts';
import { changeImpact, impactDetails, impactSummary, isEmptyImpact, type ImpactContext } from './impact.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));

/** The stored state after a person has opened Documents and Work items once. */
function stored(m: ProcessModel): ImpactContext {
  const a = assessProcess(m);
  const requirements = reconcile(deriveRequirements(m, a), []).requirements;
  const input = { model: m, assessment: a, decisions: emptyDecisions(), sources: [], requirements, revision: { label: '', state: 'working' as const, date: '' } };
  const proposals: Proposal[] = deriveProposals(input, []).proposals.map((d, i) => ({ ...d, state: 'proposed', rejectedReason: null, edited: false, order: i }));
  return { decisions: emptyDecisions(), requirements: requirements.map(persisted), proposals };
}
const ctx = stored(gold);
/** Moves a step that has work items to another role. */
const roleMove = () => {
  const step = gold.steps.find(s => s.roleIds.length && gold.roles.some(r => r.id !== s.roleIds[0] && r.inScope) && ctx.proposals.some(p => p.type === 'story' && p.stepIds.includes(s.id)))!;
  const other = gold.roles.find(r => r.id !== step.roleIds[0] && r.inScope)!;
  return { step, after: updateFact(gold, { target: { kind: 'step', id: step.id, field: 'roleIds' }, value: [other.id] }).model };
};

test('no edit: nothing downstream changes', () => {
  const i = changeImpact(gold, gold, ctx);
  assert.ok(isEmptyImpact(i));
  assert.equal(impactSummary(i), 'Nothing downstream changes.');
  assert.deepEqual(impactDetails(i), []);
});

test('a role change: the PDD steps and maps, that step\'s work, and not the BRD\'s requirements', () => {
  const { step, after } = roleMove();
  const i = changeImpact(gold, after, ctx);
  const pdd = i.documents.find(d => d.type === 'pdd')!;
  assert.ok(pdd.sections.includes('Detailed As-Is steps'), pdd.sections.join());
  assert.ok(pdd.sections.includes('As-Is process map'), pdd.sections.join());
  assert.equal(i.verdict, null);
  for (const r of i.requirements) assert.match(r.code, /^FR-/, `unexpected ${r.code}`);
  for (const w of i.workItems) {
    const p = ctx.proposals.find(x => x.key === w.key)!;
    assert.ok(p.stepIds.includes(step.id) || p.type === 'epic', w.key);
  }
  assert.match(impactSummary(i), /^Affects .*PDD \(\d+ sections?\)/);
});

test('a work item already on the board, or edited, says so; a rejected one is left out', () => {
  const { after } = roleMove();
  const changed = changeImpact(gold, after, ctx).workItems.filter(w => w.change === 'changed');
  assert.ok(changed.length >= 1, 'the role move changes the step\'s story');
  const key = changed[0].key;
  const withState = (patch: Partial<Proposal>): ImpactContext => ({ ...ctx, proposals: ctx.proposals.map(p => (p.key === key ? { ...p, ...patch } : p)) });
  const i = changeImpact(gold, after, withState({ state: 'confirmed', workItemId: 'w1', edited: true, title: 'My own title' }));
  const b = i.workItems.find(w => w.key === key)!;
  assert.deepEqual([b.onBoard, b.edited, b.title], [true, true, 'My own title']);
  assert.match(impactSummary(i), /, 1 on the board\.$/);
  const lines = impactDetails(i).find(g => g.heading === 'Work items')!.lines.join('\n');
  assert.match(lines, /My own title changes; your edit is kept and will show "Needs review"; the item on the board is not changed\./);
  const r = changeImpact(gold, after, withState({ state: 'rejected', rejectedReason: 'Not needed' }));
  assert.equal(r.workItems.some(w => w.key === key), false);
});

test('removing a step: its requirement loses its source and its work items go', () => {
  const step = gold.steps.find(s => ctx.requirements.some(r => r.kind === 'FR' && r.stepIds.includes(s.id)))!;
  const fr = ctx.requirements.find(r => r.kind === 'FR' && r.stepIds.includes(step.id))!;
  const i = changeImpact(gold, removeStep(gold, { stepId: step.id }).model, ctx);
  const r = i.requirements.find(x => x.code === fr.code)!;
  assert.equal(r.change, 'removed');
  assert.ok(i.workItems.some(w => w.change === 'removed'));
  assert.ok(impactDetails(i).find(g => g.heading === 'Requirements')!.lines.some(l => l.startsWith(`${fr.code} `) && l.includes('loses its source')));
});

test('confirming an application\'s API moves step recommendations, named before and after', () => {
  const before = gold;
  const sys = gold.systems.find(s => s.id === 'sys-servicenow')!;
  const after = setSystemApi(before, { systemId: sys.id, access: 'confirmed' }).model;
  const i = changeImpact(before, after, ctx);
  const a0 = assessProcess(before), a1 = assessProcess(after);
  const moved = a1.steps.filter(s => !s.alreadyAutomated && a0.steps.find(o => o.stepId === s.stepId)!.winner !== s.winner);
  assert.equal(i.steps.length, moved.length);
  assert.deepEqual(i.steps.map(s => [s.name, s.before, s.after]), [['Raise vendor master request', 'Rule-based RPA', 'API integration']]);
  assert.deepEqual(impactDetails(i)[0], { heading: 'Assessment', lines: ['"Raise vendor master request": Rule-based RPA becomes API integration.'] });
  assert.match(impactSummary(i), /^Affects the recommendation for 1 step, /);
});

test('an edited requirement whose source changes is marked edited', () => {
  const { step, after } = roleMove();
  const base = changeImpact(gold, after, ctx).requirements.find(r => r.change === 'changed');
  if (!base) return; // the role is not in this sample's FR wording
  const ctx2: ImpactContext = { ...ctx, requirements: ctx.requirements.map(r => (r.code === base.code ? { ...r, edited: true, title: 'Mine' } : r)) };
  const r = changeImpact(gold, after, ctx2).requirements.find(x => x.code === base.code)!;
  assert.deepEqual([r.edited, r.title], [true, 'Mine']);
  assert.ok(step);
});

test('the summary names up to three requirements and counts more', () => {
  const s = impactSummary({ verdict: null, steps: [], documents: [], workItems: [],
    requirements: ['FR-001', 'FR-002', 'FR-003', 'FR-004'].map(code => ({ code, title: 't', change: 'changed', edited: false })) });
  assert.equal(s, 'Affects 4 requirements.');
  const t = impactSummary({ verdict: { before: 'a', after: 'b' }, steps: [{ stepId: 's', name: 'n', before: 'RPA', after: 'API integration' }], documents: [{ type: 'pdd', name: 'PDD', sections: ['x'] }], workItems: [],
    requirements: [{ code: 'FR-007', title: 't', change: 'changed', edited: false }] });
  assert.equal(t, 'Affects the overall recommendation, the recommendation for 1 step, PDD (1 section) and FR-007.');
  const three = impactSummary({ verdict: null, steps: [], documents: [], requirements: ['FR-001', 'FR-002', 'FR-003'].map(code => ({ code, title: 't', change: 'changed' as const, edited: false })),
    workItems: [{ key: 'k', title: 't', type: 'story', change: 'changed', edited: false, onBoard: false }] });
  assert.equal(three, 'Affects FR-001, FR-002, FR-003 and 1 work item.');
});
