import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Fact, ProcessModel, StepTraits } from '../processModel/types.ts';
import { emptyModel } from '../processModel/empty.ts';
import { addStep, setProcessMetric, setStepTrait, setTypicalTrait } from '../processModel/patch.ts';
import { assessProcess } from './process.ts';
import { buildPortfolio, cardTotals, processCard } from './portfolio.ts';

/** A rule-based process of one step with the given yearly volume and minutes per case (0 leaves the value unknown). */
function proc(name: string, perMonth: number, minutes: number): ProcessModel {
  let m = addStep(emptyModel(name), { step: { name, taskType: 'user' } }).model;
  for (const [trait, value] of [['rulesComplete', true], ['input', 'structured'], ['judgment', false], ['physical', false]] as const) m = setTypicalTrait(m, { trait, value }).model;
  if (minutes) {
    m = setProcessMetric(m, { kind: 'volume', value: perMonth, period: 'month' }).model;
    m = setStepTrait(m, { stepId: m.steps[0].id, trait: 'effortMinutes', value: minutes }).model;
    m = setStepTrait(m, { stepId: m.steps[0].id, trait: 'sharePercent', value: 100 }).model;
  }
  return m;
}
const item = (name: string, perMonth: number, minutes: number) => ({ id: name, name, assessment: assessProcess(proc(name, perMonth, minutes)) });

test('processes are ordered quick wins first, then by hours; unplaced and empty ones are handled', () => {
  const p = buildPortfolio([item('Small', 100, 3), item('Unknown value', 0, 0), item('Big', 5000, 6), item('Medium', 1500, 4), { id: 'Empty', name: 'Empty', assessment: assessProcess(emptyModel('Empty')) }]);
  assert.deepEqual(p.rows.map(r => r.name), ['Big', 'Medium', 'Small', 'Unknown value']);
  assert.deepEqual(p.rows.map(r => r.quadrant), ['quick_win', 'quick_win', 'fill_in', null]);
  assert.deepEqual(p.rows.map(r => r.rank), [1, 2, 3, 4]);
  assert.equal(p.assessed, 4);
  assert.equal(p.rows[3].hours, null);
  assert.equal(Math.round(p.totalHours), 6000 + 1200 + 60);
});

test('80/20 across the portfolio: the fewest processes that carry 80% of the hours', () => {
  const p = buildPortfolio([item('A', 5000, 6), item('B', 1500, 4), item('C', 100, 3), item('D', 50, 2)]);
  assert.deepEqual(p.pareto.ids, ['A']);
  assert.equal(p.pareto.of, 4);
  assert.ok(p.pareto.share >= 0.8);
  assert.deepEqual(buildPortfolio([item('Only', 5000, 6)]).pareto.ids, []);
});

test('payback shows in the portfolio only where the costs are entered', () => {
  const rate = { amount: 10, currency: 'XYZ' };
  const p = buildPortfolio([
    { ...item('Costed', 1000, 6), rate, costs: { build: 6000, running: 0, enteredBy: 'x' } },
    { ...item('No costs', 1000, 6), rate },
  ]);
  assert.deepEqual(p.rows.map(r => [r.name, r.payback]), [['Costed', { best: 6, worst: 6 }], ['No costs', null]]);
});

test('a process card: the lead approach, the hours, and the steps by how they would be done', () => {
  const card = processCard(assessProcess(proc('Big', 5000, 6)))!;
  assert.equal(card.lead, 'rpa');
  assert.equal(card.steps, 1);
  assert.deepEqual(card.split, { rules: 1, ai: 0, people: 0 });
  assert.equal(card.fit, 1);
  assert.equal(Math.round(card.hours!), 6000);
  // A step that needs a person's judgment stays with people; the three parts always add up to the steps.
  let m = proc('Mixed', 5000, 6);
  m = addStep(m, { step: { name: 'Decide the exception', taskType: 'user' } }).model;
  m = setStepTrait(m, { stepId: m.steps[1].id, trait: 'judgment', value: true }).model;
  const mixed = processCard(assessProcess(m))!;
  assert.equal(mixed.steps, 2);
  assert.equal(mixed.split.rules + mixed.split.ai + mixed.split.people, 2);
  assert.equal(mixed.split.people, 1);
  assert.equal(mixed.fit, 0.5);
});

test('no card until there is a step to assess; totals count only what is known', () => {
  assert.equal(processCard(assessProcess(emptyModel('Empty'))), null);
  const unknown = processCard(assessProcess(proc('Unknown value', 0, 0)))!;
  assert.equal(unknown.hours, null);
  const totals = cardTotals([processCard(assessProcess(proc('Big', 5000, 6))), unknown, null]);
  assert.equal(totals.assessed, 2);
  assert.equal(Math.round(totals.hours), 6000);
});
