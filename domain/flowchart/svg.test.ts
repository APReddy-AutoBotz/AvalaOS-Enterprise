import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { emptyModel } from '../processModel/empty.ts';
import { flowMermaid, flowPicture, MODE_STYLE, modeFromScore } from './svg.ts';
import { buildPdd } from '../docs/pdd.ts';
import { toMarkdown } from '../docs/markdown.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

test('the As-Is map draws every step, event, gateway and flow of the model, one lane per role', () => {
  const f = flowPicture(gold);
  assert.equal(f.drawnFlows, gold.flows.length);
  assert.equal(count(f.svg, /<rect x="[\d.]+" y="[\d.]+" width="120" height="80" rx="10"/g), gold.steps.length);
  assert.equal(count(f.svg, /<circle cx/g), gold.events.length);
  for (const s of gold.steps) assert.ok(f.svg.includes(s.name.split(' ')[0]), s.name);
  assert.ok(f.svg.startsWith('<svg') && f.svg.endsWith('</svg>'));
  assert.doesNotMatch(f.svg, /<script|on\w+=/i);
});

test('the To-Be map colours each step by its mode and shows a legend for the modes used', () => {
  const a = assessProcess(gold);
  const modes = new Map(a.steps.map(s => [s.stepId, modeFromScore(s.winner, s.alreadyAutomated, s.human)]));
  const f = flowPicture(gold, { modes });
  for (const mode of new Set([...modes.values()].map(m => m.mode))) assert.ok(f.svg.includes(MODE_STYLE[mode].label), mode);
  assert.match(flowMermaid(gold, modes), /classDef rpa/);
});

test('labels are escaped; a model without flows shows steps in order and says the flow is not recorded', () => {
  const m = emptyModel('Claims <intake>');
  m.roles.push({ id: 'r1', name: 'Clerk & co', kind: 'person_role', inScope: true, sources: [], status: 'user_confirmed' } as any);
  for (const [i, n] of ['Open claim', 'Check <policy>'].entries()) m.steps.push({ id: `s${i}`, name: n, description: '', roleIds: ['r1'], systemIds: [], taskType: 'user', inputs: [], outputs: [], ruleIds: [], exceptionIds: [], sources: [], status: 'user_confirmed' } as any);
  const f = flowPicture(m);
  assert.equal(f.drawnFlows, 0);
  assert.match(f.svg, /flow between steps is not recorded/);
  assert.match(f.svg, /Check &lt;policy&gt;/);
  assert.match(f.svg, /Clerk &amp; co/);
  assert.doesNotMatch(f.svg, /<policy>/);
});

test('the PDD embeds both maps; Markdown carries them as Mermaid', () => {
  const d = buildPdd({ model: gold, assessment: assessProcess(gold), decisions: emptyDecisions(), sources: [], revision: { label: 'r', state: 'working', date: 'd' } });
  const figs = d.sections.flatMap(s => s.blocks).filter(b => b.kind === 'figure');
  assert.equal(figs.length, 2);
  assert.match(toMarkdown(d), /```mermaid\nflowchart LR/);
});
