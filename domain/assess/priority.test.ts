import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Fact, ProcessModel, StepTraits } from '../processModel/types.ts';
import { emptyModel } from '../processModel/empty.ts';
import { validateModel } from '../processModel/validate.ts';
import { adoptProcessMetric, assumeEvenEffort, setProcessMetric, setProfileFact, setStepTrait, setSystemApi, setSystemRemote, addSystem } from '../processModel/patch.ts';
import { processMetric, processMetricCandidates } from '../processModel/selectors.ts';
import { assessProcess } from './process.ts';
import { EASE_BANDS, EASE_MULTIPLIERS, EASE_VALUES, EASE_WEIGHTS, PRIORITY } from './priority.ts';

const src = [{ sourceId: 'sop', locator: { section: '6' }, excerpt: 'quoted text' }];
const f = <T>(value: T): Fact<T> => ({ value, status: 'stated', sources: src });
const RULES: StepTraits = { rulesComplete: f(true), input: f('structured'), judgment: f(false), physical: f(false), language: f(false), write: f('record') };

/** `n` rule-based steps on one system with stable screens: an RPA-led process. */
function rpaProcess(n = 3, traits: StepTraits = RULES): ProcessModel {
  const m = emptyModel('Case');
  m.systems.push({ id: 'sys', name: 'ERP', kind: 'erp', inScope: true, access: [], uiStable: f(true), status: 'stated', sources: src });
  for (let i = 0; i < n; i++) m.steps.push({ id: `s-${i}`, name: `Enter record ${i + 1}`, description: '', roleIds: [], systemIds: ['sys'], taskType: 'user', inputs: [], outputs: [], ruleIds: [], exceptionIds: [], status: 'stated', sources: src, traits: JSON.parse(JSON.stringify(traits)) });
  assert.deepEqual(validateModel(m).issues.filter(i => i.severity === 'error'), []);
  return m;
}
const withEffort = (m: ProcessModel, minutes: number[], share = 100) => m.steps.reduce((cur, s, i) => setStepTrait(setStepTrait(cur, { stepId: s.id, trait: 'effortMinutes', value: minutes[i] }).model, { stepId: s.id, trait: 'sharePercent', value: share }).model, m);

test('ease weights add up to 100 and every value is between 0 and 1', () => {
  assert.equal(Object.values(EASE_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  for (const v of [...Object.values(EASE_VALUES.change), ...Object.values(EASE_VALUES.input), ...EASE_VALUES.steps.map(b => b[1]), ...Object.values(EASE_MULTIPLIERS)]) assert.ok(v >= 0 && v <= 1);
});

test('a short, stable, structured process on one application is easy; the arithmetic is the weighted sum', () => {
  let m = rpaProcess(3);
  m = setProfileFact(m, { fact: 'processChange', value: 'none' }).model;
  m = setProfileFact(m, { fact: 'systemChange', value: 'none' }).model;
  const ease = assessProcess(m).priority.ease!;
  assert.equal(ease.score, 100);
  assert.equal(ease.band, 'easy');
  assert.equal(ease.knownShare, 1);
  assert.equal(Math.round(ease.factors.reduce((t, x) => t + x.points, 0)), 100);
});

test('unknown stability counts as half and is reported as not known', () => {
  const ease = assessProcess(rpaProcess(3)).priority.ease!;
  assert.equal(ease.score, Math.round(100 - (EASE_WEIGHTS.processStability + EASE_WEIGHTS.systemStability) * 0.5));
  assert.equal(ease.factors.find(x => x.id === 'processStability')!.known, false);
  assert.equal(assessProcess(rpaProcess(3)).priority.readiness.open.length, 2);
});

test('a major change expected means wait, whatever the fit', () => {
  const m = setProfileFact(rpaProcess(3), { fact: 'systemChange', value: 'major' }).model;
  const r = assessProcess(m);
  assert.equal(r.verdict, 'RPA-led automation');
  assert.equal(r.priority.readiness.state, 'wait');
  assert.match(r.priority.readiness.reasons[0], /applications/);
});

test('a fired redesign caution means fix first', () => {
  const m = rpaProcess(3, { ...RULES, rework: f(true) });
  assert.equal(assessProcess(m).priority.readiness.state, 'fix_first');
});

test('remote desktop, scans and AI each make the build harder by their published factor', () => {
  const plain = assessProcess(rpaProcess(3)).priority.ease!;
  const base = plain.score;
  const remote = assessProcess(setSystemRemote(rpaProcess(3), { systemId: 'sys', value: true }).model).priority.ease!;
  assert.equal(remote.score, Math.round(plain.factors.reduce((t, x) => t + x.points, 0) * EASE_MULTIPLIERS.remoteDesktop));
  assert.equal(remote.multipliers[0].id, 'remoteDesktop');
  const reading = assessProcess(rpaProcess(3, { ...RULES, input: f('unstructured'), rulesComplete: f(false) }));
  assert.ok(reading.counts.ai_assist > 0, 'unstructured input without rules needs AI');
  assert.ok(reading.priority.ease!.multipliers.some(x => x.id === 'aiSteps'));
  assert.ok(reading.priority.ease!.score < base);
});

test('many steps and exception paths make it difficult', () => {
  const m = rpaProcess(24, { ...RULES, input: f('semi_structured') });
  for (let i = 0; i < 12; i++) m.exceptions.push({ id: `ex-${i}`, kind: 'business', name: `Exception ${i}`, trigger: 't', stepIds: [], handling: 'h', status: 'stated', sources: src });
  let cur = setProfileFact(m, { fact: 'processChange', value: 'minor' }).model;
  cur = setSystemRemote(cur, { systemId: 'sys', value: true }).model;
  const ease = assessProcess(cur).priority.ease!;
  assert.ok(ease.score < EASE_BANDS.medium + 15, `score ${ease.score}`);
  assert.notEqual(ease.band, 'easy');
});

test('value needs volume, effort and share; with them the process is placed in a quadrant', () => {
  let m = rpaProcess(3);
  assert.equal(assessProcess(m).priority.placement.placed, false);
  m = setProcessMetric(m, { kind: 'volume', value: 2000, period: 'month' }).model;
  m = withEffort(m, [2, 1, 1]);
  const high = assessProcess(m).priority;
  assert.equal(high.value.computable, true);
  assert.equal(Math.round(high.value.value!.mid), 2000 * 12 * 4 / 60);
  assert.ok(high.value.value!.mid >= PRIORITY.valueHoursPerYear);
  assert.equal(high.placement.quadrant, 'quick_win');
  const low = assessProcess(setProcessMetric(m, { kind: 'volume', value: 200, period: 'month' }).model).priority;
  assert.equal(low.placement.quadrant, 'fill_in');
  let long = rpaProcess(24, { ...RULES, input: f('semi_structured') });
  for (let i = 0; i < 12; i++) long.exceptions.push({ id: `ex-${i}`, kind: 'business', name: `Exception ${i}`, trigger: 't', stepIds: [], handling: 'h', status: 'stated', sources: src });
  long = setSystemRemote(setProcessMetric(long, { kind: 'volume', value: 2000, period: 'month' }).model, { systemId: 'sys', value: true }).model;
  const hard = assessProcess(withEffort(long, long.steps.map(() => 1))).priority;
  assert.ok(hard.ease!.score < PRIORITY.ease, `ease ${hard.ease!.score}`);
  assert.equal(hard.placement.quadrant, 'major_project');
});

test('80/20 on the steps: the fewest steps that carry 80% of the effort', () => {
  let m = setProcessMetric(rpaProcess(5), { kind: 'volume', value: 100, period: 'day' }).model;
  m = withEffort(m, [10, 6, 2, 1, 1]);
  const focus = assessProcess(m).priority.focus;
  assert.deepEqual(focus.value!.stepIds, ['s-0', 's-1']);
  assert.equal(focus.value!.of, 5);
  assert.equal(assessProcess(rpaProcess(5)).priority.focus.computable, false);
});

test('80/20 on the cases: the standard path share and the caution above 20% exceptions', () => {
  const ok = assessProcess(setProcessMetric(rpaProcess(2), { kind: 'exception_rate', value: 12 }).model).priority.standardPath;
  assert.equal(ok.value!.share, 0.88);
  assert.equal(ok.value!.caution, false);
  const many = assessProcess(setProcessMetric(rpaProcess(2), { kind: 'exception_rate', value: 35 }).model).priority.standardPath;
  assert.equal(many.value!.caution, true);
  assert.equal(assessProcess(rpaProcess(2)).priority.standardPath.computable, false);
});

test('inputs: completeness counts what is known and rises as facts are entered', () => {
  const before = assessProcess(rpaProcess(2)).priority.inputs;
  assert.equal(before.groups.find(g => g.id === 'facts')!.known, 12);
  assert.equal(before.groups.find(g => g.id === 'profile')!.known, 0);
  let m = setProcessMetric(rpaProcess(2), { kind: 'volume', value: 10, period: 'week' }).model;
  m = setSystemApi(m, { systemId: 'sys', access: 'confirmed_absent' }).model;
  const after = assessProcess(m).priority.inputs;
  assert.ok(after.share > before.share);
  assert.equal(after.groups.find(g => g.id === 'applications')!.known, 2);
});

test('a metric read from the sources is corrected in place and keeps its quotes; clearing it makes it unknown', () => {
  const m = rpaProcess(1);
  m.meta.metrics.push({ id: 'm1', kind: 'volume', label: 'Invoices', value: null, range: [900, 1100], unit: 'invoices/month', appliesTo: 'process', status: 'stated', sources: src });
  const next = setProcessMetric(m, { kind: 'volume', value: 1200, period: 'week' }).model;
  assert.equal(next.meta.metrics.length, 1);
  assert.deepEqual([next.meta.metrics[0].value, next.meta.metrics[0].unit, next.meta.metrics[0].status, next.meta.metrics[0].sources.length, next.meta.metrics[0].range], [1200, 'cases/week', 'user-confirmed', 1, undefined]);
  const cleared = setProcessMetric(next, { kind: 'volume', value: null }).model;
  assert.equal(cleared.meta.metrics[0].status, 'unknown');
  assert.throws(() => setProcessMetric(m, { kind: 'exception_rate', value: 140 }), /between 0 and 100/);
});

test('an API a person confirms for a system makes API integration the recommendation for its steps', () => {
  let m = addSystem(rpaProcess(0), { name: 'Billing', kind: 'erp' }).model;
  const id = m.systems.find(s => s.name === 'Billing')!.id;
  m.steps.push({ id: 's-x', name: 'Create billing record', description: '', roleIds: [], systemIds: [id], taskType: 'user', inputs: [], outputs: [], ruleIds: [], exceptionIds: [], status: 'stated', sources: src, traits: JSON.parse(JSON.stringify(RULES)) });
  assert.notEqual(assessProcess(m).steps[0].winner, 'api');
  m = setSystemApi(m, { systemId: id, access: 'confirmed' }).model;
  assert.equal(assessProcess(m).steps[0].winner, 'api');
  m = setSystemApi(m, { systemId: id, access: 'confirmed_absent' }).model;
  assert.equal(m.systems.find(s => s.id === id)!.access.length, 1);
  assert.equal(assessProcess(m).steps[0].winner, 'rpa');
});

test('the same model always gives the same priority', () => {
  const m = withEffort(setProcessMetric(rpaProcess(4), { kind: 'volume', value: 500, period: 'month' }).model, [3, 2, 2, 1]);
  assert.deepEqual(assessProcess(m).priority, assessProcess(JSON.parse(JSON.stringify(m))).priority);
});

test('figures the sources state in their own words fill the profile: one candidate is used, several wait for a choice', () => {
  const m = rpaProcess(2);
  const metric = (id: string, kind: any, label: string, unit: string, value: number | null, range?: [number, number], appliesTo = 'AP invoices') =>
    ({ id, kind, label, unit, value, ...(range ? { range } : {}), appliesTo, status: 'stated' as const, sources: src });
  m.meta.metrics.push(
    metric('v1', 'volume', 'Monthly invoice volume', 'invoices per month', null, [9000, 10000]),
    metric('v2', 'volume', 'Sample invoices requested', 'invoices', 10),
    metric('h1', 'handling_time', 'Clean invoice handling time', 'minutes', null, [10, 12]),
    metric('h2', 'handling_time', 'Exception invoice handling time', 'minutes', null, [35, 40]),
    metric('h3', 'handling_time', 'Vendor follow-ups', 'hour per day', 1),
    metric('e1', 'exception_rate', 'Invoices with an exception', 'percent', 28),
  );
  assert.equal(processMetric(m, 'volume')!.id, 'v1');
  assert.deepEqual(assessProcess(m).priority.standardPath.value!.share, 0.72);
  assert.equal(assessProcess(m).priority.standardPath.value!.caution, true);
  assert.equal(processMetric(m, 'handling_time'), undefined);
  assert.deepEqual(processMetricCandidates(m, 'handling_time').map(x => x.id), ['h1', 'h2']);
  const chosen = adoptProcessMetric(m, { metricId: 'h1' }).model;
  assert.equal(processMetric(chosen, 'handling_time')!.id, 'h1');
  assert.equal(processMetric(adoptProcessMetric(chosen, { metricId: 'h2' }).model, 'handling_time')!.id, 'h2');
  // Correcting the figure keeps its quotes and does not add a second one.
  const corrected = setProcessMetric(m, { kind: 'volume', value: 9500, period: 'month' }).model;
  assert.equal(corrected.meta.metrics.filter(x => x.kind === 'volume').length, 2);
  assert.deepEqual([processMetric(corrected, 'volume')!.id, processMetric(corrected, 'volume')!.sources.length], ['v1', 1]);
});

test('spreading the time per case is a recorded assumption: it gives a value and is flagged until confirmed', () => {
  let m = setProcessMetric(rpaProcess(4), { kind: 'volume', value: 1000, period: 'month' }).model;
  m = setStepTrait(m, { stepId: 's-0', trait: 'effortMinutes', value: 2 }).model;
  m = assumeEvenEffort(m, { minutesPerCase: 11 }).model;
  assert.deepEqual(m.steps.map(s => [s.traits!.effortMinutes!.value, s.traits!.effortMinutes!.status]), [[2, 'user-confirmed'], [3, 'assumed'], [3, 'assumed'], [3, 'assumed']]);
  assert.equal(assessProcess(m).priority.value.computable, false, 'share of cases is still needed');
  for (const s of m.steps) m = setStepTrait(m, { stepId: s.id, trait: 'sharePercent', value: 100 }).model;
  const v = assessProcess(m).priority.value.value!;
  assert.equal(Math.round(v.mid), 1000 * 12 * 11 / 60);
  assert.equal(v.assumedSteps, 3);
  assert.throws(() => assumeEvenEffort(m, { minutesPerCase: 11 }), /already has a time/);
});
