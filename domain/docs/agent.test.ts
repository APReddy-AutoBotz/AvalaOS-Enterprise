import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { reconcile } from '../requirements/register.ts';
import { setBriefFact } from '../processModel/patch.ts';
import { agentSteps, buildAgent } from './agent.ts';
import { toMarkdown } from './markdown.ts';
import type { DocInput } from './common.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const inputOf = (m: ProcessModel, decisions = emptyDecisions()): DocInput => {
  const a = assessProcess(m, { decisions });
  return { model: m, assessment: a, decisions, sources: [], requirements: reconcile(deriveRequirements(m, a), []).requirements, revision: { label: 'Revision 1', state: 'working', date: '15 November 2026' } };
};
const FILLER = /\b(TBD|lorem|placeholder|to be decided|N\/A|etc\.)/i;

const ov = (stepId: string, approach: 'agent' | 'ai_assist' | 'human' | 'rpa', rationale = 'Varies too much for fixed rules.') => ({ stepId, approach, rationale, by: 'Analyst', at: '2026-11-15' });
const scored = assessProcess(gold).steps.filter(s => !s.alreadyAutomated);
const [s1, , s3] = scored.filter(s => s.winner !== 'human').map(s => s.stepId);
/** Two steps set to AI by a person: one agentic, one AI-assisted. */
const withAi = () => ({ ...emptyDecisions(), overrides: { [s1]: ov(s1, 'agent'), [s3]: ov(s3, 'ai_assist') } });

test('the agent takes on exactly the steps in effect AI-assisted or agentic, in process order', () => {
  const i = inputOf(gold, withAi());
  const ai = i.assessment.steps.filter(s => !s.alreadyAutomated && (s.winner === 'agent' || s.winner === 'ai_assist')).map(s => s.stepId);
  const ours = agentSteps(i);
  assert.deepEqual(ours.map(a => a.step.id).sort(), [...ai].sort());
  assert.deepEqual(ours.map(a => a.step.id), [s1, s3].filter(id => ai.includes(id)));
  assert.deepEqual(ours.map(a => a.approach), ['agent', 'ai_assist']);
  assert.ok(ours.every(a => a.byPerson));
  const d = buildAgent(i);
  const table = d.sections.find(s => s.title === 'What the agent does')!.blocks.find(b => b.kind === 'table') as any;
  assert.equal(table.rows.length, 2);
  assert.match(toMarkdown(d), /set so by a person/);
  // The steps around it hold every other step once.
  const around = d.sections.find(s => s.title === 'The steps around it')!.blocks.find(b => b.kind === 'table') as any;
  assert.equal(around.rows.length, gold.steps.length - 2);
});

test('nothing is filled in: limits, accounts, reviewers and test cases are open items, listed again at the end', () => {
  const d = buildAgent(inputOf(gold, withAi()));
  const md = toMarkdown(d);
  assert.doesNotMatch(md, FILLER);
  assert.equal(d.type, 'agent');
  assert.deepEqual(d.sections.filter(s => s.level === 1).map(s => s.title), [
    'Purpose and scope', 'What the agent does', 'The steps around it', 'Decisions and rules it applies', 'When it hands over to a person',
    'Applications it uses and its access', 'Data it reads and produces', 'Limits and controls', 'How its work is checked before it goes live', 'Running and watching it', 'Open questions',
  ]);
  for (const q of [/What must the agent never do/, /Up to what limit/, /What does a wrong action by the agent cost/, /Which past cases/, /Who may stop the agent/]) {
    assert.ok(d.openItems.some(o => q.test(o.text)), String(q));
  }
  const apps = new Set([s1, s3].flatMap(id => gold.steps.find(s => s.id === id)!.systemIds));
  for (const id of apps) assert.ok(d.openItems.some(o => o.text.startsWith('With which account does the agent work in') && o.target?.id === id));
  const closing = d.sections.at(-1)!.blocks.find(b => b.kind === 'table') as any;
  assert.equal(closing.rows.length, d.openItems.length);
  assert.match(md, /Proposed, not confirmed/);
});

test('a step a person keeps with people leaves the agent', () => {
  const d = { ...withAi(), overrides: { ...withAi().overrides, [s1]: ov(s1, 'human', 'Our reviewers read these.') } };
  assert.deepEqual(agentSteps(inputOf(gold, d)).map(a => a.step.id), [s3]);
});

test('with no AI steps it says so, and an agent in mind is compared, never assumed', () => {
  assert.equal(agentSteps(inputOf(gold)).length, 0, 'the sample alone has no AI steps');
  const m = setBriefFact(gold, { fact: 'inMind', value: ['agent'] }).model;
  const d = buildAgent(inputOf(m));
  const md = toMarkdown(d);
  assert.match(md, /the agent has no steps yet/);
  assert.match(md, /The team has an AI agent in mind, but no step is rated for AI/);
  assert.ok(d.openItems.some(o => o.text === 'Which steps should the agent take on?'));
  assert.ok(!d.openItems.some(o => /never do/.test(o.text)), 'no limits asked for an agent with no steps');
});

test('with only AI-assisted steps, the document says no step is agentic and nothing acts on its own', () => {
  const assist = { ...emptyDecisions(), overrides: { [s3]: ov(s3, 'ai_assist') } };
  const md = toMarkdown(buildAgent(inputOf(gold, assist)));
  assert.match(md, /No step is agentic, so nothing here acts on its own/);
  assert.doesNotMatch(md, /what an AI agent would do/);
  // With an agentic step it is an agent's document.
  assert.match(toMarkdown(buildAgent(inputOf(gold, withAi()))), /what an AI agent would do/);
});
