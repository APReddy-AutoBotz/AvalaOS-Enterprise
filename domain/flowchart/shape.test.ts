import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { emptyModel } from '../processModel/empty.ts';
import { assessProcess } from '../assess/process.ts';
import { decisionsFromEntries, decisionsToEntries, emptyDecisions, withMapShape, withOverride, withRate } from '../assess/decisions.ts';
import { MAP_SHAPE, mapShape, shapeInEffect } from './shape.ts';
import { flowMermaid, flowPicture, modeFromScore, verticalLayout, modelToBpmnVertical } from './svg.ts';
import { buildPdd } from '../docs/pdd.ts';
import { changedSections } from '../docs/changes.ts';
import { toMarkdown } from '../docs/markdown.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/** A process with `roles` roles, each doing `per` steps in a row, joined by flows. */
function chain(roles: number, per = 2, opts: { unassigned?: boolean; flows?: boolean } = {}): ProcessModel {
  const m = emptyModel('Claims handling');
  for (let r = 0; r < roles; r++) m.roles.push({ id: `r${r}`, name: `Role ${r + 1}`, kind: 'person_role', inScope: true, sources: [], status: 'user_confirmed' } as any);
  const ids: string[] = [];
  const add = (id: string, roleIds: string[]) => {
    m.steps.push({ id, name: `Step ${id}`, description: '', roleIds, systemIds: [], taskType: 'user', inputs: [], outputs: [], ruleIds: [], exceptionIds: [], sources: [], status: 'user_confirmed' } as any);
    ids.push(id);
  };
  for (let r = 0; r < Math.max(roles, 1); r++) for (let k = 0; k < per; k++) add(`s${r}-${k}`, roles ? [`r${r}`] : []);
  if (opts.unassigned) add('s-none', []);
  if (opts.flows !== false) ids.slice(1).forEach((id, i) => m.flows.push({ id: `f${i}`, from: ids[i], to: id, label: '', isException: false, sources: [], status: 'user_confirmed' } as any));
  return m;
}

test('the rule: one role or none is a simple flow, so is more than six columns; otherwise swimlanes', () => {
  assert.equal(MAP_SHAPE.maxColumns, 6);
  const none = mapShape(chain(0));
  assert.equal(none.shape, 'simple');
  assert.match(none.reason, /no step has a role/);
  const one = mapShape(chain(1));
  assert.equal(one.shape, 'simple');
  assert.match(one.reason, /^Drawn as a simple flow: one role does every step/);
  assert.equal(mapShape(chain(6)).shape, 'swimlanes');
  const seven = mapShape(chain(7));
  assert.equal(seven.shape, 'simple');
  assert.equal(seven.reason, "Drawn as a simple flow: this process has seven roles, more than a page can hold side by side. Switch to swimlanes to see each role's column.");
  // "No role recorded" is a column too: six roles and steps with no role make seven columns.
  const six = mapShape(chain(6, 2, { unassigned: true }));
  assert.equal(six.columns, 7);
  assert.equal(six.shape, 'simple');
  assert.match(six.reason, /seven columns \(six roles, and steps with no role recorded\)/);
  // The number is a working default: one table row changes it.
  assert.equal(mapShape(chain(7), { maxColumns: 8 }).shape, 'swimlanes');
});

test('the sample (five roles) stays in swimlanes, so the homepage pictures and the demo stay as they are', () => {
  const s = mapShape(gold);
  assert.equal(s.roles, 5);
  assert.equal(s.shape, 'swimlanes');
  assert.equal(shapeInEffect(gold, emptyDecisions()).shape, 'swimlanes');
  // The swimlane map is drawn exactly as before the shape existed.
  assert.equal(flowPicture(gold).svg, flowPicture(gold, { shape: 'swimlanes' }).svg);
});

test("a person's choice wins over the suggestion, is kept with the other decisions, and choosing the suggestion removes it", () => {
  let d = withMapShape(emptyDecisions(), { shape: 'simple', suggested: 'swimlanes', by: 'Analyst', at: '2026-11-16' });
  const e = shapeInEffect(gold, d);
  assert.equal(e.shape, 'simple');
  assert.equal(e.suggested, 'swimlanes');
  assert.equal(e.chosen, true);
  // Stored as one more entry among the decisions, read back, and not lost by other decisions.
  const back = decisionsFromEntries(decisionsToEntries(d));
  assert.deepEqual(back.map, { shape: 'simple', by: 'Analyst', at: '2026-11-16' });
  d = withRate(back, { amount: 30, currency: 'EUR', enteredBy: 'x' });
  const step = assessProcess(gold).steps.find(s => !s.alreadyAutomated)!;
  d = withOverride(d, step, { approach: step.winner === 'human' ? 'rpa' : 'human', rationale: 'Because.', by: 'Analyst' });
  assert.equal(d.map?.shape, 'simple');
  assert.equal(shapeInEffect(chain(7), withMapShape(emptyDecisions(), { shape: 'swimlanes', suggested: 'simple', by: 'A' })).shape, 'swimlanes');
  // Choosing the suggested shape removes the choice, so the suggestion follows the process again.
  assert.equal(withMapShape(d, { shape: 'swimlanes', suggested: 'swimlanes', by: 'Analyst' }).map, null);
  // Older stored decisions have no shape: the suggestion holds.
  assert.equal(decisionsFromEntries([{ kind: 'rate', amount: 1, currency: 'EUR' }]).map, null);
  assert.equal(decisionsFromEntries([{ kind: 'map', shape: 'sideways', by: 'x', at: 'y' }]).map, null);
});

test('the simple flow draws every step, decision point and path of the swimlane map, with each step\'s role in its box', () => {
  const lanes = flowPicture(gold);
  const simple = flowPicture(gold, { shape: 'simple' });
  assert.equal(simple.drawnFlows, lanes.drawnFlows);
  assert.equal(simple.drawnFlows, gold.flows.length);
  assert.equal(count(simple.svg, /width="150" height="70" rx="9"/g), gold.steps.length);
  assert.equal(count(simple.svg, /<circle cx/g), gold.events.length);
  assert.equal(count(simple.svg, /stroke="#B45309" stroke-width="1.5"/g), count(lanes.svg, /stroke="#B45309" stroke-width="1.5"/g));
  assert.equal(count(simple.svg, /marker-end/g), count(lanes.svg, /marker-end/g));
  for (const s of gold.steps) assert.ok(simple.svg.includes(`<title>${s.name.replace(/&/g, '&amp;')}</title>`), s.name);
  // One column: no role headings; every step's role is written in its box, the whole name on hover.
  const roles = new Set(gold.steps.flatMap(s => s.roleIds.slice(0, 1)));
  assert.equal(count(simple.svg, /data-role=/g), gold.steps.length);
  for (const id of roles) {
    const name = gold.roles.find(r => r.id === id)!.name.replace(/&/g, '&amp;');
    assert.ok(simple.svg.includes(`<title>Role: ${name}`), name);
  }
  assert.ok(simple.width < lanes.width, `${simple.width} < ${lanes.width}`);
  // A hand-over is marked where the role changes from the step before, and only there.
  const handovers = count(simple.svg, /data-role="handover"/g);
  assert.ok(handovers > 0 && handovers < gold.steps.length, String(handovers));
  // The To-Be colours, the check dot and the legend stay.
  const a = assessProcess(gold);
  const modes = new Map(a.steps.map(s => [s.stepId, modeFromScore(s.winner, s.alreadyAutomated, s.human)]));
  const tobe = flowPicture(gold, { shape: 'simple', modes }).svg;
  assert.equal(count(tobe, /A person checks the result/g), count(flowPicture(gold, { modes }).svg, /A person checks the result/g));
  assert.match(tobe, /Rule-based RPA/);
  // Markdown carries the same shape: no lanes, the role beside each step.
  const md = flowMermaid(gold, modes, 'simple');
  assert.doesNotMatch(md, /subgraph/);
  assert.match(md, /\(AP Clerk\)/);
  assert.match(flowMermaid(gold, modes), /subgraph/);
});

test('in a simple flow the hand-over line follows the flow, and one role makes no hand-over', () => {
  const svg = flowPicture(chain(3), { shape: 'simple' }).svg;
  // Three roles of two steps each in a row: the work changes hands twice.
  assert.equal(count(svg, /data-role="handover"/g), 2);
  assert.equal(count(flowPicture(chain(1, 4), { shape: 'simple' }).svg, /data-role="handover"/g), 0);
});

test('with no flows recorded the simple flow still shows the steps in order and says so', () => {
  const m = chain(2, 2, { flows: false });
  const f = flowPicture(m, { shape: 'simple' });
  assert.equal(f.drawnFlows, 0);
  assert.match(f.svg, /flow between steps is not recorded/);
  const L = verticalLayout(m, { shape: 'simple' });
  const ys = L.order.map(s => L.centre(L.graph.nodes.find(n => n.id === s.id)!).y);
  assert.deepEqual([...ys].sort((x, y) => x - y), ys);
  assert.equal(new Set(L.order.map(s => L.centre(L.graph.nodes.find(n => n.id === s.id)!).x)).size, 1);
  // The hand-over still shows between the steps in order.
  assert.equal(count(f.svg, /data-role="handover"/g), 1);
});

test('across the page is the same simple flow turned on its side', () => {
  const down = verticalLayout(gold, { shape: 'simple' });
  const across = verticalLayout(gold, { shape: 'simple', across: true });
  const node = (L: typeof down, id: string) => L.centre(L.graph.nodes.find(n => n.id === id)!);
  // The order along the flow becomes left to right.
  for (const [a, b] of [[gold.steps[0].id, gold.steps[2].id]]) {
    assert.equal(Math.sign(node(down, b).y - node(down, a).y), Math.sign(node(across, b).x - node(across, a).x));
  }
  assert.ok(across.pool.w > across.pool.h);
  assert.ok(down.pool.h > down.pool.w);
  const f = flowPicture(gold, { shape: 'simple', across: true });
  assert.equal(f.drawnFlows, gold.flows.length);
  assert.equal(count(f.svg, /width="150" height="70" rx="9"/g), gold.steps.length);
  // Swimlanes are never turned.
  assert.equal(flowPicture(gold, { across: true }).svg, flowPicture(gold).svg);
});

test('the flow editor stays in swimlanes whatever shape the maps are in', () => {
  assert.match(modelToBpmnVertical(gold), /<bpmn:lane /);
});

test('the PDD and its Markdown carry the shape in effect; the same shape on both sides changes no section', () => {
  const input = (m: ProcessModel, decisions = emptyDecisions(), mapShape?: 'swimlanes' | 'simple') => ({ model: m, assessment: assessProcess(m, { decisions }), decisions, sources: [], revision: { label: 'r', state: 'working' as const, date: 'd' }, ...(mapShape ? { mapShape } : {}) });
  const figs = (d: ReturnType<typeof buildPdd>) => d.sections.flatMap(s => s.blocks).filter(b => b.kind === 'figure') as { svg: string; mermaid: string }[];
  const lanes = buildPdd(input(gold));
  assert.ok(figs(lanes).every(f => !f.svg.includes('data-role=')));
  const chosen = withMapShape(emptyDecisions(), { shape: 'simple', suggested: 'swimlanes', by: 'A' });
  const simple = buildPdd(input(gold, chosen));
  assert.equal(figs(simple).length, 2);
  assert.ok(figs(simple).every(f => f.svg.includes('data-role=') && !f.mermaid.includes('subgraph')));
  assert.doesNotMatch(toMarkdown(simple), /subgraph/);
  // The owner's kind of process (seven roles) is a simple flow in the document on its own.
  assert.ok(figs(buildPdd(input(chain(7)))).every(f => f.svg.includes('data-role=')));
  // A comparison with an approved revision draws both sides in the shape in effect now, even where the
  // approved model on its own would be drawn otherwise (six roles then, seven now).
  assert.equal(shapeInEffect(chain(6), null).shape, 'swimlanes');
  assert.ok(figs(buildPdd(input(chain(6), emptyDecisions(), 'simple'))).every(f => f.svg.includes('data-role=')));
  // Switching the shape and building both sides with it changes nothing either.
  assert.deepEqual(changedSections(buildPdd(input(gold, chosen, 'simple')), buildPdd(input(gold, emptyDecisions(), 'simple'))), []);
});
