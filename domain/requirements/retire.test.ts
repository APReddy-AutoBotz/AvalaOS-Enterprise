import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { decideApproach, removeDecidedApproach } from '../processModel/patch.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions, withOverride, withoutOverride } from '../assess/decisions.ts';
import { deriveRequirements } from './derive.ts';
import { reconcile, type StoredRequirement } from './register.ts';
import { requirementsOnChoices, requirementsOnSwitch } from './switch.ts';
import { linkedCodes, touchedByPerson } from './retire.ts';
import type { Proposal } from '../workitems/register.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const AT = '2026-11-17T06:00:00Z';
const d = emptyDecisions();
/** What Documents saves when it opens. */
const opened = (m: ProcessModel, stored: StoredRequirement[], dd = d) => reconcile(deriveRequirements(m, assessProcess(m, { decisions: dd })), stored).requirements;
const apply = (stored: StoredRequirement[], rows: StoredRequirement[] | null) => {
  const by = new Map(stored.map(r => [r.code, r]));
  for (const r of rows ?? []) by.set(r.code, r);
  return [...by.values()];
};
const inState = (rs: StoredRequirement[], state: StoredRequirement['state']) => rs.filter(r => r.state === state).map(r => r.code).sort();
const apisUnknown = (m: ProcessModel) => { const x = structuredClone(m); for (const s of x.systems) for (const a of s.access) if (a.method === 'api') a.access = 'unknown'; return x; };
const proposal = (code: string, over: Partial<Proposal> = {}): Proposal => ({ key: `story:${code}`, type: 'story', parentKey: null, title: code, description: '', acceptance: ['a', 'b'], stepIds: [], requirements: [code], state: 'proposed', rejectedReason: null, edited: false, order: 0, ...over });

/** Decided as API integration from the start, Documents opened; then no application's API is confirmed. */
function decidedApi() {
  const decided = decideApproach(gold(), { approach: 'api', reason: 'The client integrates through APIs only', by: 'u1', at: AT }).model;
  const stored = opened(decided, []);
  assert.deepEqual(inState(stored, 'source_removed'), []);
  const unknown = apisUnknown(decided);
  return { decided, stored, unknown, removed: removeDecidedApproach(unknown, { by: 'u1', at: AT }).model };
}

test('decided as API integration, Documents opened, the decision removed: what it alone brought is retired with the reason; an edited one stays "Source removed"', () => {
  const { stored, unknown, removed } = decidedApi();
  const lost = inState(opened(removed, stored), 'source_removed');
  assert.ok(lost.length >= 2, 'the decision brought requirements the scoring does not');
  const edited = stored.map(r => (r.code === lost[0] ? { ...r, statement: 'Our own wording.', edited: true } : r));
  const after = apply(edited, requirementsOnSwitch(unknown, removed, d, edited));
  assert.deepEqual(inState(after, 'source_removed'), [lost[0]], 'the edited one is for a person to decide');
  assert.deepEqual(inState(after, 'retired'), lost.slice(1));
  for (const r of after.filter(x => x.state === 'retired')) assert.equal(r.retiredReason, 'Applied only while API integration was the decided approach');
  // Nothing is deleted and no code is reused: every code is still there, and what the scoring adds gets new ones.
  for (const r of edited) assert.ok(after.some(x => x.code === r.code), r.code);
  assert.equal(new Set(after.map(r => r.code)).size, after.length);
});

test('a proposal a person touched, or a tester\'s edit, keeps its requirement; a proposal nobody touched does not', () => {
  const { stored, unknown, removed } = decidedApi();
  const lost = inState(opened(removed, stored), 'source_removed');
  const [a, b, c, e] = lost;
  const proposals = [proposal(a!), proposal(b!, { state: 'selected' }), proposal(c!, { edited: true }), proposal('FR-999', { state: 'rejected' })];
  assert.equal(touchedByPerson(proposals[0]!), false);
  for (const p of [proposal('x', { state: 'selected' }), proposal('x', { state: 'rejected' }), proposal('x', { edited: true }), proposal('x', { key: 'user:9:story:x' }), proposal('x', { workItemId: 'w1' }), proposal('x', { state: 'confirmed' })]) assert.equal(touchedByPerson(p), true);
  const linked = linkedCodes(proposals, [{ caseCode: `${e}.1`, fields: { expected: 'Posted' }, setAside: false, baseHash: null }]);
  const after = apply(stored, requirementsOnSwitch(unknown, removed, d, stored, linked));
  assert.deepEqual(inState(after, 'source_removed'), [b, c, e].sort(), 'selected, edited and named by a tester stay');
  assert.ok(inState(after, 'retired').includes(a!), 'an untouched proposal follows its requirement');
  // An added case names its requirement in its fields.
  assert.ok(linkedCodes([], [{ caseCode: 'added:1', fields: { requirement: 'FR-007', title: 'Mine' }, setAside: false, baseHash: null }]).has('FR-007'));
});

test('deciding the same approach again brings a retired requirement back active, with its code and without the reason', () => {
  const m = gold();
  const rpa = decideApproach(m, { approach: 'rpa', reason: 'One platform', by: 'u1', at: AT }).model;
  const start = opened(rpa, []);
  const api = decideApproach(rpa, { approach: 'api', reason: 'APIs only', by: 'u1', at: AT }).model;
  const switched = apply(start, requirementsOnSwitch(rpa, api, d, start));
  const retired = switched.filter(r => r.state === 'retired');
  assert.ok(retired.length > 0);
  for (const r of retired) assert.equal(r.retiredReason, 'Applied only while Rule-based RPA was the decided approach');
  const again = decideApproach(api, { approach: 'rpa', reason: 'Back to one platform', by: 'u1', at: AT }).model;
  const back = apply(switched, requirementsOnSwitch(api, again, d, switched));
  for (const r of retired) {
    const now = back.find(x => x.code === r.code)!;
    assert.equal(now.state, 'active', `${r.code} is back`);
    assert.equal(now.key, r.key);
    assert.equal(now.retiredReason, undefined);
  }
});

test('a person\'s choice for one step withdrawn: the requirement only it brought is retired, naming the step', () => {
  const m = gold();
  const scoring = assessProcess(m, {});
  const step = scoring.steps.find(s => s.winner === 'human' && !s.alreadyAutomated)!;
  const chosen = withOverride(d, step, { approach: 'rpa', rationale: 'The check follows a written list', by: 'Asha', at: AT });
  const stored = opened(m, [], chosen);
  const brought = stored.find(r => r.key === `step:${step.stepId}`)!;
  assert.ok(brought, 'the choice brought a requirement for the step');
  const after = apply(stored, requirementsOnChoices(m, chosen, withoutOverride(chosen, step.stepId), stored));
  const r = after.find(x => x.code === brought.code)!;
  assert.equal(r.state, 'retired');
  assert.match(r.retiredReason!, /^Applied only while a person had chosen Rule-based RPA for step \d+ ".+"$/);
  // Nothing went away: nothing to save.
  assert.equal(requirementsOnChoices(m, chosen, chosen, stored), null);
});
