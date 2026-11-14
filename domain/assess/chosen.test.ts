// A person's choice of approach for a step is followed everywhere that is built for the future process
// (owner's decision, 14 November 2026): the assessment with decisions, the requirements, the work
// proposals, the To-Be maps and the documents. The scores and the scoring's own answer never change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from './process.ts';
import { effectiveApproach, emptyDecisions, withOverride, type Decisions } from './decisions.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { reconcile } from '../requirements/register.ts';
import { deriveProposals } from '../workitems/derive.ts';
import { buildPdd } from '../docs/pdd.ts';
import { changeImpact } from '../docs/impact.ts';
import { flowPicture, modeFromScore } from '../flowchart/svg.ts';
import { askFacts } from '../assistant/ask.ts';
import type { DocInput } from '../docs/common.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const scoring = assessProcess(gold);
// A step the scoring automates, and one it keeps with a person.
const auto = scoring.steps.find(s => !s.alreadyAutomated && s.winner !== 'human')!;
const human = scoring.steps.find(s => !s.alreadyAutomated && s.winner === 'human')!;
const toHuman = withOverride(emptyDecisions(), auto, { approach: 'human', rationale: 'Auditors want a person here.', by: 'Meera' });
const toRpa = withOverride(emptyDecisions(), human, { approach: 'rpa', rationale: 'We will script it.', by: 'Meera' });
const input = (decisions: Decisions): DocInput => {
  const assessment = assessProcess(gold, { decisions });
  return { model: gold, assessment, decisions, sources: [], requirements: reconcile(deriveRequirements(gold, assessment), []).requirements, revision: { label: 'Working draft', state: 'working', date: '14 November 2026' } };
};

test('with decisions, the step takes the chosen approach, keeps the scoring\'s answer, and the counts follow; scores do not change', () => {
  const a = assessProcess(gold, { decisions: toHuman });
  const step = a.steps.find(s => s.stepId === auto.stepId)!;
  assert.equal(step.winner, 'human');
  assert.equal(step.recommended, auto.winner);
  assert.deepEqual(step.scores, auto.scores);
  assert.equal(a.counts.human, scoring.counts.human + 1);
  assert.equal(a.counts[auto.winner], scoring.counts[auto.winner] - 1);
  assert.notEqual(a.split, scoring.split);
  assert.deepEqual(a.ranking.map(r => [r.approach, r.score]), scoring.ranking.map(r => [r.approach, r.score]), 'the ranking\'s scores are the scoring\'s');
  // Without decisions, or with an override that matches the scoring, it is the scoring alone.
  assert.deepEqual(assessProcess(gold, { decisions: emptyDecisions() }), scoring);
  assert.ok(assessProcess(gold).steps.every(s => s.recommended === undefined));
});

test('the verdict follows the approach in effect for the most steps once people have chosen', () => {
  // The scoring alone leads with API integration on this case. Put every automated step on rule-based
  // RPA (one technology for the process): the verdict must follow, whatever the scores rank first.
  assert.equal(scoring.verdict, 'API-led integration');
  let d = emptyDecisions();
  for (const s of scoring.steps.filter(x => !x.alreadyAutomated && x.winner !== 'human' && x.winner !== 'rpa')) d = withOverride(d, s, { approach: 'rpa', rationale: 'One technology for the process.', by: 'Meera' });
  const a = assessProcess(gold, { decisions: d });
  assert.equal(a.lead, 'rpa');
  assert.equal(a.verdict, 'RPA-led automation');
  assert.match(a.split, /^Of 20 steps people do today: Rule-based RPA for 14, 6 stay with people\./);
  assert.equal(a.ranking[0]!.approach, scoring.ranking[0]!.approach, 'the ranking by score is still the scoring\'s');
});

test('choosing the scoring\'s own answer on a step already shown with a choice removes the override', () => {
  const inEffect = assessProcess(gold, { decisions: toHuman }).steps.find(s => s.stepId === auto.stepId)!;
  const back = withOverride(toHuman, inEffect, { approach: auto.winner, rationale: '', by: 'Meera' });
  assert.deepEqual(back.overrides, {});
  assert.equal(effectiveApproach(inEffect, toHuman).approach, 'human');
});

test('requirements follow the choice, and only the overridden step\'s wording changes', () => {
  const before = deriveRequirements(gold, scoring);
  const after = deriveRequirements(gold, assessProcess(gold, { decisions: toRpa }));
  const forStep = (list: typeof before) => list.filter(r => r.key.includes(human.stepId));
  const was = forStep(before), now = forStep(after);
  assert.ok(now.some(r => /Approach chosen by a person: Rule-based RPA \(the scoring recommends Keep with a person\)\./.test(r.rationale ?? '')), 'an automation requirement for the chosen step');
  assert.notDeepEqual(was.map(r => r.key), now.map(r => r.key));
  // Every other requirement is word for word the same, so nothing else turns "Needs review".
  const others = (list: typeof before) => list.filter(r => !r.key.includes(human.stepId)).map(r => [r.key, r.statement, r.rationale]);
  assert.deepEqual(others(after), others(before));
});

test('work proposals follow the choice', () => {
  const plain = deriveProposals(input(emptyDecisions()), []);
  const chosen = deriveProposals(input(toRpa), []);
  const mentions = (d: typeof plain) => d.proposals.filter(p => (p.stepIds ?? []).includes(human.stepId) && p.type !== 'task').map(p => p.type);
  assert.notDeepEqual(mentions(chosen), mentions(plain));
});

test('the To-Be map follows the choice; the As-Is map does not', () => {
  const modes = (d: Decisions) => new Map(assessProcess(gold, { decisions: d }).steps.map(s => [s.stepId, modeFromScore(s.winner, s.alreadyAutomated, s.human)]));
  assert.notEqual(flowPicture(gold, { modes: modes(toHuman) }).svg, flowPicture(gold, { modes: modes(emptyDecisions()) }).svg);
  const pdd = (d: Decisions) => buildPdd(input(d)).sections.flatMap(s => s.blocks).filter(b => b.kind === 'figure').map(b => (b as { svg: string }).svg);
  const [asIsBefore, toBeBefore] = pdd(emptyDecisions()), [asIsAfter, toBeAfter] = pdd(toHuman);
  assert.equal(asIsAfter, asIsBefore);
  assert.notEqual(toBeAfter, toBeBefore);
});

test('change impact compares with the choices in force on both sides', () => {
  const m = structuredClone(gold);
  const step = m.steps.find(s => s.id === auto.stepId)!;
  step.name = `${step.name} (renamed)`;
  const imp = changeImpact(gold, m, { decisions: toHuman, requirements: [], proposals: [] });
  // The step stays with a person on both sides, so no recommendation "moves" because of the choice.
  assert.ok(!imp.steps.some(r => r.stepId === auto.stepId));
});

test('Ask Avala states the scoring\'s recommendation and, separately, the approach a person chose', () => {
  const facts = askFacts('Why is this step kept with a person?', { model: gold, assessment: assessProcess(gold, { decisions: toHuman }) });
  const f = facts.find(x => x.id === `a:step:${auto.stepId}`)!;
  assert.match(f.text, new RegExp(`recommended approach ${{ rpa: 'Rule-based RPA', api: 'API integration', ai_assist: 'AI-assisted automation', agent: 'Agentic AI', human: 'Keep with a person' }[auto.winner]}`));
  assert.match(f.text, /The approach in effect is Keep with a person, chosen by a person\.$/);
});
