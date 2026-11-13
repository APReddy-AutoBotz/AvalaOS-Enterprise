import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { validateModel } from '../processModel/validate.ts';
import { modelToBpmn, parseBpmn } from './bpmn.ts';
import { applyFlowPlan, lintFlow, planFlowEdits } from './edit.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const graphOf = (m: ProcessModel) => parseBpmn(modelToBpmn(m));
const pairs = (m: ProcessModel) => m.flows.map(f => `${f.from}>${f.to}:${f.label ?? ''}`).sort();

test('saving the drawing unchanged changes nothing', () => {
  const plan = planFlowEdits(gold, graphOf(gold));
  assert.deepEqual(plan.changes, []);
  const r = applyFlowPlan(gold, plan);
  assert.deepEqual(pairs(r.model), pairs(gold));
  assert.equal(r.model.steps.length, gold.steps.length);
  assert.deepEqual(r.model.flows.map(f => f.id).sort(), gold.flows.map(f => f.id).sort());
});

test('rename, move to another lane, add a step with a new role, remove a step, reconnect: listed in words and applied in one valid edit', () => {
  const g = graphOf(gold);
  const [first, second] = gold.steps;
  const n1 = g.nodes.find(n => n.id === first.id)!;
  n1.label = 'Log the invoice in the tracker';
  const other = gold.roles.find(r => r.id !== first.roleIds[0] && gold.steps.some(s => s.roleIds[0] === r.id))!;
  n1.laneId = other.id;
  g.lanes.push({ id: 'Lane_new', name: 'Shared Services Robot Team' });
  g.nodes.push({ id: 'Activity_1abc', kind: 'task', label: 'Check sanctions list', laneId: 'Lane_new' });
  const inToSecond = g.edges.find(e => e.to === second.id)!;
  // Remove the second step: its flows go; connect the new step in its place.
  const outOfSecond = g.edges.filter(e => e.from === second.id);
  g.nodes = g.nodes.filter(n => n.id !== second.id);
  g.edges = g.edges.filter(e => e.from !== second.id && e.to !== second.id);
  g.edges.push({ id: 'Flow_a', from: inToSecond.from, to: 'Activity_1abc' });
  for (const o of outOfSecond) g.edges.push({ id: `Flow_b_${o.id}`, from: 'Activity_1abc', to: o.to, ...(o.label ? { label: o.label } : {}) });
  const plan = planFlowEdits(gold, g);
  const text = plan.changes.join('\n');
  assert.ok(text.includes(`Rename the step "${first.name}" to "Log the invoice in the tracker"`), text);
  assert.match(text, new RegExp(`Move "Log the invoice in the tracker" to ${other.name.replace(/[()/]/g, '.')}`));
  assert.match(text, /Add the role "Shared Services Robot Team"/);
  assert.match(text, /Add the step "Check sanctions list" for Shared Services Robot Team/);
  assert.match(text, new RegExp(`Remove the step "${second.name}"`));
  assert.match(text, /Connect .* to "Check sanctions list"/);
  const r = applyFlowPlan(gold, plan);
  assert.equal(validateModel(r.model).valid, true);
  const added = r.model.steps.find(s => s.name === 'Check sanctions list')!;
  const robot = r.model.roles.find(x => x.name === 'Shared Services Robot Team')!;
  assert.deepEqual(added.roleIds, [robot.id]);
  assert.equal(r.model.steps.find(s => s.id === first.id)!.roleIds[0], other.id);
  assert.equal(r.model.steps.find(s => s.id === first.id)!.systemIds.join(), first.systemIds.join(), 'systems kept');
  assert.ok(!r.model.steps.some(s => s.id === second.id));
  assert.ok(!r.model.exceptions.some(e => e.stepIds.includes(second.id)));
  assert.ok(r.model.flows.some(f => f.to === added.id));
  // Exception marks on kept flows survive.
  for (const f of gold.flows.filter(x => x.isException && x.from !== second.id && x.to !== second.id)) assert.ok(r.model.flows.find(y => y.id === f.id)?.isException, f.id);
});

test('an unnamed new element is left out with a warning, never given an invented name', () => {
  const g = graphOf(gold);
  g.nodes.push({ id: 'Activity_x', kind: 'task', label: '' });
  const plan = planFlowEdits(gold, g);
  assert.match(plan.warnings.join(), /has no name/);
  assert.equal(applyFlowPlan(gold, plan).model.steps.length, gold.steps.length);
});

test('lint: missing start or end, dead ends and unlabelled decision paths', () => {
  const g = graphOf(gold);
  assert.deepEqual(lintFlow(g).filter(x => /no start|no end/.test(x)), []);
  g.nodes = g.nodes.filter(n => n.kind !== 'end');
  g.nodes.push({ id: 'gw', kind: 'gateway', label: 'Urgent?', gatewayType: 'exclusive' }, { id: 't1', kind: 'task', label: 'A' }, { id: 't2', kind: 'task', label: 'B' });
  g.edges.push({ id: 'x1', from: 'gw', to: 't1' }, { id: 'x2', from: 'gw', to: 't2', label: 'Yes' });
  const l = lintFlow(g).join('\n');
  assert.match(l, /no end event/);
  assert.match(l, /Label each way out of the decision "Urgent\?"/);
  assert.match(l, /"?Urgent\?"? has no flow into it|Urgent\? has no flow into it/);
});
