import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { answerQuestion, removeStep, updateFact } from '../processModel/patch.ts';
import { incoming, orderedSteps, outgoing } from '../processModel/selectors.ts';
import { validateModel } from '../processModel/validate.ts';
import { applyChanges, proposeChanges } from './rebase.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const empty = (name: string): ProcessModel => ({
  ...gold(), meta: { name, objective: { value: null, status: 'unknown', sources: [] }, owner: { value: null, status: 'unknown', sources: [] }, scopeIn: [], scopeOut: [], metrics: [] },
  roles: [], systems: [], events: [], steps: [], gateways: [], flows: [], rules: [], exceptions: [], dataObjects: [], painPoints: [], controls: [], risks: [], openQuestions: [], conflicts: [],
});
const defaults = (cs: ReturnType<typeof proposeChanges>) => new Set(cs.changes.filter(c => c.defaultSelected).map(c => c.id));

test('the first extraction into an empty model is taken whole, keeping the process name', () => {
  const cs = proposeChanges(empty('Invoices'), gold());
  assert.equal(cs.first, true);
  assert.equal(cs.changes.filter(c => c.element === 'step').length, gold().steps.length);
  const next = applyChanges(empty('Invoices'), gold(), defaults(cs));
  assert.equal(next.meta.name, 'Invoices');
  assert.deepEqual({ ...next, meta: { ...next.meta, name: gold().meta.name } }, gold());
});

test('extracting the same sources again changes nothing', () => {
  const cs = proposeChanges(gold(), gold());
  assert.equal(cs.first, false);
  assert.deepEqual(cs.changes, []);
  assert.ok(cs.unchanged > 40);
  assert.deepEqual(applyChanges(gold(), gold(), new Set()), gold());
});

test('re-extraction never overwrites a confirmed value: it records a conflict instead', () => {
  let m = gold();
  const step = m.steps.find(s => s.roleIds.length === 1)!;
  const other = m.roles.find(r => r.id !== step.roleIds[0])!;
  m = updateFact(m, { target: { kind: 'step', id: step.id, field: 'roleIds' }, value: [other.id] }).model;
  m = updateFact(m, { target: { kind: 'step', id: step.id, field: 'name' }, value: 'A name only I use' }).model;
  const q = m.openQuestions[0];

  const cs = proposeChanges(m, gold());
  const forStep = cs.changes.filter(c => c.currentId === step.id);
  assert.equal(forStep.length, 1, 'matched by its quotes despite the new name');
  assert.equal(forStep[0].kind, 'conflict');
  assert.ok(!cs.changes.some(c => c.kind === 'add' && c.element === 'step'), 'no duplicate step');

  const next = applyChanges(m, gold(), defaults(cs));
  const after = next.steps.find(s => s.id === step.id)!;
  assert.deepEqual(after.roleIds, [other.id]);
  assert.equal(after.name, 'A name only I use');
  assert.equal(after.status, 'user-confirmed');
  const conflict = next.conflicts.find(c => c.target.kind === 'step' && c.target.id === step.id)!;
  assert.ok(conflict && conflict.resolution === null);
  assert.equal(conflict.values.length, 2);
  assert.ok(validateModel(next).valid);

  // An answered question stays answered and its confirmed field stays.
  const answered = answerQuestion(m, { questionId: q.id, answer: 'Checked with the team' }).model;
  const again = applyChanges(answered, gold(), defaults(proposeChanges(answered, gold())));
  assert.equal(again.openQuestions.find(x => x.id === q.id)?.status, 'answered');
});

test('a step the extraction adds is inserted into the flow, not beside it', () => {
  const g = gold();
  const middle = orderedSteps(g).find(s => incoming(g, s.id).length === 1 && outgoing(g, s.id).length === 1
    && !g.flows.some(f => f.from === incoming(g, s.id)[0].from && f.to === outgoing(g, s.id)[0].to))!;
  const before = incoming(g, middle.id)[0].from, after = outgoing(g, middle.id)[0].to;
  const current = removeStep(g, { stepId: middle.id }).model;
  const cs = proposeChanges(current, g);
  const add = cs.changes.find(c => c.kind === 'add' && c.element === 'step')!;
  assert.equal(add.label, middle.name);
  const next = applyChanges(current, g, defaults(cs));
  const added = next.steps.find(s => s.name === middle.name)!;
  assert.deepEqual(incoming(next, added.id).map(f => f.from), [before]);
  assert.deepEqual(outgoing(next, added.id).map(f => f.to), [after]);
  assert.ok(!next.flows.some(f => f.from === before && f.to === after), 'the direct flow was replaced');
  assert.equal(orderedSteps(next).findIndex(s => s.id === added.id), orderedSteps(g).findIndex(s => s.id === middle.id));
});

test('what the sources no longer show is offered for removal, unselected, and never if confirmed', () => {
  const g = gold();
  const extracted = removeStep(g, { stepId: g.steps[3].id }).model;
  let current = g;
  current = updateFact(current, { target: { kind: 'step', id: g.steps[5].id, field: 'description' }, value: 'Mine' }).model;
  const extracted2 = removeStep(extracted, { stepId: g.steps[5].id }).model;
  const cs = proposeChanges(current, extracted2);
  const removals = cs.changes.filter(c => c.kind === 'remove' && c.element === 'step');
  assert.deepEqual(removals.map(c => c.currentId), [g.steps[3].id]);
  assert.equal(removals[0].defaultSelected, false);
  assert.ok(applyChanges(current, extracted2, defaults(cs)).steps.some(s => s.id === g.steps[3].id));
  assert.ok(!applyChanges(current, extracted2, new Set([removals[0].id])).steps.some(s => s.id === g.steps[3].id));
});

test('a changed access route is described in words, never as raw data', () => {
  const g = gold();
  const changed = structuredClone(g);
  const sys = changed.systems.find(s => s.id === 'sys-tracker')!;
  sys.access = [...sys.access, { method: 'api', name: 'Graph', operations: [], access: 'confirmed', status: 'stated', sources: [] }];
  const c = proposeChanges(g, changed).changes.find(x => x.element === 'system' && x.currentId === 'sys-tracker')!;
  assert.ok(c, 'the tracker change is proposed');
  assert.doesNotMatch(c.detail, /object Object|\{/);
  assert.match(c.detail, /access: file: reported, not confirmed → file: reported, not confirmed; API Graph: confirmed available/);
});
