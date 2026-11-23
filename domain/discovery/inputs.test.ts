// Package B, pull request 1: input cards ask the inputs the assessment lists, with the Inputs view's
// fields and operations; a period said in words is read by a rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { processMetric } from '../processModel/selectors.ts';
import { setPurpose } from '../processModel/patch.ts';
import { inputCards, inputEdit, periodFrom, type InputCard } from './inputs.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const cardOf = (m: ProcessModel, id: string) => inputCards(m, assessProcess(m)).find(c => c.inputId === id) as InputCard | undefined;

test('the sample: one card per input the assessment lists, in its order, each with a gap and a target', () => {
  const a = assessProcess(gold);
  const cards = inputCards(gold, a);
  assert.deepEqual(cards.map(c => c.inputId), a.priority.nextInputs.map(n => n.id).filter(id => cards.some(c => c.inputId === id)));
  assert.deepEqual(cards.map(c => c.inputId), ['time', 'change', 'api', 'fact']);
  assert.ok(cards.every(c => c.question.length <= 200));
  for (const c of cards) {
    assert.equal(c.group, 'input');
    assert.equal(c.answer, 'field');
    assert.equal(c.origin.kind, 'gap');
    assert.match(c.origin.kind === 'gap' ? c.origin.gap : '', /^Not recorded yet: /);
  }
});

test('each field writes with the Inputs view\'s operation; an incomplete answer writes nothing', () => {
  const a = assessProcess(gold);
  for (const c of inputCards(gold, a)) {
    const f = c.field;
    if (f.kind === 'figure') {
      assert.equal(inputEdit(c, {}), null);
      if (f.period) assert.equal(inputEdit(c, { number: 500 }), null, 'a volume needs its period');
      const m = inputEdit(c, { number: 500, period: 'month', unit: 'minutes' })!(gold).model;
      assert.equal(processMetric(m, f.metric)!.value, 500);
    } else if (f.kind === 'change') {
      assert.equal(inputEdit(c, {}), null);
      assert.equal(inputEdit(c, { level: 'minor' })!(gold).model.meta.profile!.processChange!.value, 'minor');
    } else if (f.kind === 'api') {
      assert.equal(inputEdit(c, { covers: [] }), null);
      const m = inputEdit(c, { covers: [f.stepIds[0]!] })!(gold).model;
      assert.notDeepEqual(m.systems.find(s => s.id === f.systemId)!.access, gold.systems.find(s => s.id === f.systemId)!.access);
    } else if (f.kind === 'fact') {
      assert.equal(inputEdit(c, { pick: 'nonsense' }), null);
      const m = inputEdit(c, { pick: f.choices[0]![0] })!(gold).model;
      assert.notDeepEqual(m, gold);
    } else if (f.kind === 'per_step') {
      const m = inputEdit(c, { perStep: { [f.stepIds[0]!]: 4 } })!(gold).model;
      assert.equal(m.steps.find(s => s.id === f.stepIds[0])!.traits![f.trait]!.value, 4);
    }
  }
});

test('a volume said in words: the period from the words, or asked with the field', () => {
  const c = cardOf(gold, 'volume');
  if (c) {
    const said = 'We get about 1,200 invoices a month.';
    const m = inputEdit(c, { number: 1200, period: periodFrom(said)! })!(gold).model;
    assert.equal(processMetric(m, 'volume')!.unit, 'cases/month');
  }
  assert.equal(periodFrom('about 500 a month'), 'month');
  assert.equal(periodFrom('roughly 40 per week'), 'week');
  assert.equal(periodFrom('12,000 annually'), 'year');
  assert.equal(periodFrom('every day around 60'), 'day');
  assert.equal(periodFrom('quarterly, 3,000'), 'quarter');
  assert.equal(periodFrom('about 500'), null, 'no period: the field asks');
  assert.equal(periodFrom('40 a week, so about 160 a month'), null, 'two periods: the field asks');
  assert.equal(periodFrom('the monthly close'), 'month');
});

test('a process documented as it is gets no input card', () => {
  const m = setPurpose(gold, { value: 'as_is', by: 'u1', at: '2026-11-23T10:00:00.000Z' }).model;
  assert.deepEqual(inputCards(m, assessProcess(m)), []);
});
