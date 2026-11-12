import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Fact, ProcessModel, StepTraits } from '../processModel/types.ts';
import { emptyModel } from '../processModel/empty.ts';
import { addStep, setProcessMetric, setStepTrait, setTypicalTrait } from '../processModel/patch.ts';
import { assessProcess } from './process.ts';
import { buildPortfolio } from './portfolio.ts';

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
