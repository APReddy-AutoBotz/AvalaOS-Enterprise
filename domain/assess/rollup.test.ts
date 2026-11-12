import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import type { Fact, ProcessModel, StepTraits } from '../processModel/types.ts';
import { emptyModel } from '../processModel/empty.ts';
import { rollUp, THRESHOLDS, yearlyVolume } from './rollup.ts';

const src = [{ sourceId: 'sop', locator: {}, excerpt: 'x' }];
const f = <T>(value: T): Fact<T> => ({ value, status: 'stated', sources: src });
const known = { rework: f(false), physical: f(false), judgment: f(false) };

function model(steps: StepTraits[], opts: { volume?: [number, number] | number; unit?: string; api?: boolean } = {}): ProcessModel {
  const m = emptyModel('P');
  if (opts.api) m.systems = [{ id: 'sap', name: 'SAP', kind: 'erp', inScope: true, status: 'stated', sources: src, access: [{ method: 'api', operations: ['Post invoice'], access: 'confirmed', status: 'stated', sources: src }] }];
  m.steps = steps.map((traits, i) => ({ id: `s${i}`, name: i === steps.length - 1 && opts.api ? 'Post invoice' : `Step ${i}`, description: '', roleIds: [], systemIds: i === steps.length - 1 && opts.api ? ['sap'] : [], taskType: 'user', inputs: [], outputs: [], ruleIds: [], exceptionIds: [], status: 'stated', sources: src, traits }));
  if (opts.volume !== undefined) {
    const v = opts.volume;
    m.meta.metrics = [{ id: 'm1', kind: 'volume', label: 'Invoices', value: Array.isArray(v) ? null : v, ...(Array.isArray(v) ? { range: v } : {}), unit: opts.unit ?? 'invoices/month', appliesTo: 'process', status: 'stated', sources: src }];
  }
  return m;
}

const rules = (effort?: number, share?: number): StepTraits => ({ ...known, rulesComplete: f(true), input: f('structured'), ...(effort !== undefined ? { effortMinutes: f(effort) } : {}), ...(share !== undefined ? { sharePercent: f(share) } : {}) });
const human = (effort?: number, share?: number): StepTraits => ({ ...known, judgment: f(true), ...(effort !== undefined ? { effortMinutes: f(effort) } : {}), ...(share !== undefined ? { sharePercent: f(share) } : {}) });
const extract = (effort?: number, share?: number): StepTraits => ({ ...known, input: f('paper'), ...(effort !== undefined ? { effortMinutes: f(effort) } : {}), ...(share !== undefined ? { sharePercent: f(share) } : {}) });

test('the composition summary counts what needs no AI', () => {
  const r = rollUp(model([rules(), rules(), human(), extract(), {...known, input: f('structured')}], { api: true }));
  assert.equal(r.summary, '3 of 5 steps need no AI: 1 by API, 2 by rules; 1 need document extraction; 1 stay with people.');
  assert.equal(r.noAiSteps, 3);
  assert.equal(r.headline, 'Automate mostly without AI; AI is needed in 1 step.');
  assert.deepEqual(r.composition.map(c => [c.mechanism, c.count]), [['keep_human', 1], ['rules', 2], ['api', 1], ['extraction', 1]]);
});

test('without volume and effort, potential, hours and money say why they are not computed', () => {
  const r = rollUp(model([rules(), human()]));
  assert.deepEqual(r.potential, { computable: false, reason: 'Effort is missing on 2 of 2 steps.' });
  assert.deepEqual(r.hours, { computable: false, reason: 'The process volume is not known.' });
  assert.deepEqual(r.money, { computable: false, reason: 'No cost rate has been entered.' });
  assert.equal(r.gates.find(g => g.id === 'not_worth_automating')!.fired, false);
});

test('hours come from volume, effort and share; AI steps count as a range', () => {
  const r = rollUp(model([rules(10, 100), extract(6, 20), human(20, 50)], { volume: [9000, 10000] }));
  // minutes per case: 10 + 1.2 + 10 = 21.2; automatable: rules 10 (+ extraction 1.2 at most)
  assert.ok(r.hours.computable);
  if (r.hours.computable) {
    assert.deepEqual(r.hours.value!.today.map(Math.round), [Math.round(108000 * 21.2 / 60), Math.round(120000 * 21.2 / 60)]);
    assert.deepEqual(r.hours.value!.automatable.map(Math.round), [Math.round(108000 * 10 / 60), Math.round(120000 * 11.2 / 60)]);
  }
  assert.ok(r.potential.computable);
  if (r.potential.computable) assert.deepEqual(r.potential.value!.map(x => Math.round(x * 1000)), [Math.round(10 / 21.2 * 1000), Math.round(11.2 / 21.2 * 1000)]);
  assert.equal(r.money.computable, false);
  const priced = rollUp(model([rules(10, 100), extract(6, 20), human(20, 50)], { volume: [9000, 10000] }), { rate: { amount: 2, currency: 'EUR', enteredBy: 'ap@example.com' } });
  assert.ok(priced.money.computable);
  if (priced.money.computable) { assert.equal(priced.money.value!.currency, 'EUR'); assert.match(priced.money.note ?? '', /entered by ap@example.com/); }
});

test('share missing blocks hours but not potential', () => {
  const r = rollUp(model([rules(10), human(5, 100)], { volume: 1000 }));
  assert.deepEqual(r.hours, { computable: false, reason: 'The share of cases is missing on 1 of 2 steps.' });
  assert.ok(r.potential.computable);
  if (r.potential.computable) assert.match(r.potential.note ?? '', /share is not stated/);
});

test('volume periods convert to a year; an unclear period is not guessed', () => {
  assert.deepEqual(yearlyVolume(model([], { volume: 100, unit: 'cases/week' })), { computable: true, value: [5200, 5200] });
  assert.deepEqual(yearlyVolume(model([], { volume: 20, unit: 'cases per day' })), { computable: true, value: [5000, 5000] });
  assert.equal(yearlyVolume(model([], { volume: 20, unit: 'cases' })).computable, false);
});

test('gates fire at their documented thresholds', () => {
  const low = rollUp(model([{}, {}, {}, rules()]));
  assert.equal(low.gates.find(g => g.id === 'discovery_needed')!.fired, true);
  assert.match(low.headline, /^Discovery needed/);
  const ok = rollUp(model([rules(), rules(), rules(), {}]));
  assert.equal(ok.gates.find(g => g.id === 'discovery_needed')!.fired, false, `1 of 4 is not above ${THRESHOLDS.discoveryLowConfidenceShare}`);

  const rework = rollUp(model([{ ...known, rework: f(true) }, rules(), rules(), rules(), rules()]));
  assert.equal(rework.gates.find(g => g.id === 'redesign_first')!.fired, true, '1 of 5 is 20%');

  const unstable = rollUp(model([{ ...known, rulesComplete: f(false) }, rules()]));
  assert.equal(unstable.gates.find(g => g.id === 'hold_for_instability')!.fired, true);

  const small = rollUp(model([rules(5, 100)], { volume: 100, unit: 'cases/year' }));
  assert.equal(small.gates.find(g => g.id === 'not_worth_automating')!.fired, true);
  assert.match(small.headline, /Not worth automating/);
  const big = rollUp(model([rules(5, 100)], { volume: 1000, unit: 'cases/week' }));
  assert.equal(big.gates.find(g => g.id === 'not_worth_automating')!.fired, false);
  assert.equal(big.headline, 'Automate without AI: every step can be handled by rules, an API, UI automation or is already done by a system.');
});

test('API questions from the steps are collected once', () => {
  const m = model([{ ...known, input: f('structured') }, { ...known, input: f('structured') }]);
  m.systems = [{ id: 'erp', name: 'ERP', kind: 'erp', inScope: true, access: [], status: 'stated', sources: src }];
  m.steps.forEach(s => { s.systemIds = ['erp']; });
  m.steps[1].name = m.steps[0].name;
  const r = rollUp(m);
  assert.equal(r.questions.length, 1);
  assert.equal(r.composition[0].mechanism, 'api_candidate');
});

test('no monetary literal appears in the assessment code', () => {
  const dir = new URL('./', import.meta.url);
  const money = /([$€£₹¥]\s?\d)|(\d[\d,.]*\s?(USD|EUR|GBP|INR|dollars?|euros?|rupees?)\b)|\b(hourly_?cost|cost_?per_?hour|DEFAULT_[A-Z_]*COST)\b/i;
  for (const file of readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const text = readFileSync(new URL(file, dir), 'utf8');
    assert.doesNotMatch(text, money, `${file} contains a monetary literal`);
  }
});

test('overrides need a rationale, survive storage, and leave the rules answer visible', async () => {
  const { withOverride, withoutOverride, withRate, decisionsFromEntries, decisionsToEntries, effectiveMechanism, emptyDecisions, DecisionError } = await import('./decisions.ts');
  const r = rollUp(model([rules()])).steps[0];
  assert.throws(() => withOverride(emptyDecisions(), r, { mechanism: 'keep_human', rationale: '  ', by: 'a' }), DecisionError);
  let d = withOverride(emptyDecisions(), r, { mechanism: 'keep_human', rationale: 'Audit wants a person', by: 'lead@example.com', at: '2026-11-12T00:00:00Z' });
  d = withRate(d, { amount: 30, currency: 'EUR', enteredBy: 'lead@example.com' });
  const back = decisionsFromEntries(JSON.parse(JSON.stringify(decisionsToEntries(d))));
  assert.deepEqual(back, d);
  assert.deepEqual(effectiveMechanism(r, back), { mechanism: 'keep_human', override: back.overrides[r.stepId] });
  assert.equal(r.mechanism, 'rules', 'the rules answer is unchanged');
  assert.deepEqual(withOverride(back, r, { mechanism: 'rules', rationale: '', by: 'a' }).overrides, {}, 'choosing the rules answer removes the override');
  assert.deepEqual(withoutOverride(back, r.stepId).overrides, {});
  assert.throws(() => withRate(d, { amount: 0, currency: 'EUR', enteredBy: 'x' }), DecisionError);
  assert.deepEqual(decisionsFromEntries('nonsense'), emptyDecisions());
});
