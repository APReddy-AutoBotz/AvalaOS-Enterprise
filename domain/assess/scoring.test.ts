import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import type { AccessMethod, Fact, ProcessModel, Step, StepTraits, SystemRef } from '../processModel/types.ts';
import { emptyModel } from '../processModel/empty.ts';
import { validateModel } from '../processModel/validate.ts';
import { setStepTrait, setSystemUiStable } from '../processModel/patch.ts';
import { CAPS, COMPLEXITY_PENALTY, FIT, HUMAN_FLOOR, WEIGHTS, scoreOf, scoreStep, type Approach, type HumanPoint } from './scoring.ts';
import { assessProcess, yearlyVolume } from './process.ts';
import { DecisionError, decisionsFromEntries, decisionsToEntries, effectiveApproach, emptyDecisions, withOverride, withoutOverride, withRate } from './decisions.ts';

const src = [{ sourceId: 'sop', locator: { section: '6' }, excerpt: 'quoted text' }];
const f = <T>(value: T): Fact<T> => ({ value, status: 'stated', sources: src });

type Api = 'confirmed' | 'confirmed-nocover' | 'reported' | 'unknown' | 'absent' | 'none';
interface Sys { kind?: SystemRef['kind']; api: Api; ui?: boolean }
interface StepSpec { name?: string; type?: Step['taskType']; traits?: StepTraits; systems?: Sys[] }

function build(specs: StepSpec[], opts: { volume?: [number, number] | number; unit?: string } = {}): ProcessModel {
  const m = emptyModel('Case');
  specs.forEach((spec, n) => {
    const ids = (spec.systems ?? []).map((s, i) => {
      const access: AccessMethod[] = [];
      const status = s.api.startsWith('confirmed') ? 'confirmed' : s.api === 'absent' ? 'confirmed_absent' : s.api;
      if (s.api !== 'none') access.push({ method: 'api', name: 'API_X', operations: [s.api === 'confirmed-nocover' ? 'Read vendor master' : 'Post supplier invoice'], access: status as AccessMethod['access'], status: 'stated', sources: src });
      const sys: SystemRef = { id: `sys-${n}-${i}`, name: `System ${n + 1}${i ? `.${i}` : ''}`, kind: s.kind ?? 'erp', inScope: true, access, status: 'stated', sources: src };
      if (s.ui !== undefined) sys.uiStable = f(s.ui);
      m.systems.push(sys);
      return sys.id;
    });
    m.steps.push({ id: `s-${n}`, name: spec.name ?? 'Post supplier invoice', description: '', roleIds: [], systemIds: ids, taskType: spec.type ?? 'user', inputs: [], outputs: [], ruleIds: [], exceptionIds: [], status: 'stated', sources: src, ...(spec.traits ? { traits: spec.traits } : {}) });
  });
  if (opts.volume !== undefined) {
    const v = opts.volume;
    m.meta.metrics = [{ id: 'm1', kind: 'volume', label: 'Cases', value: Array.isArray(v) ? null : v, ...(Array.isArray(v) ? { range: v } : {}), unit: opts.unit ?? 'cases/month', appliesTo: 'process', status: 'stated', sources: src }];
  }
  assert.deepEqual(validateModel(m).issues.filter(i => i.severity === 'error'), [], 'fixture is valid');
  return m;
}

const clear: StepTraits = { rulesComplete: f(true), input: f('structured'), judgment: f(false), physical: f(false), language: f(false) };
const agentAll = { ambiguity: f(true), adaptive: f(true), toolChoice: f(true), value: f(true), controllable: f(true) };

interface Row { name: string; traits?: StepTraits; systems?: Sys[]; type?: Step['taskType']; winner: Approach; second?: Approach; human?: HumanPoint; forNow?: boolean; ai?: boolean; min?: number; max?: number }
const rows: Row[] = [
  // ---- RPA is the default where no API is confirmed
  { name: 'nothing known, works in a system: RPA, API second', systems: [{ api: 'none' }], winner: 'rpa', second: 'api', ai: false },
  { name: 'clear rules, structured, unknown API: RPA strong', traits: clear, systems: [{ api: 'unknown' }], winner: 'rpa', second: 'api', min: FIT.strong },
  { name: 'clear rules, structured, reported API: still RPA', traits: clear, systems: [{ api: 'reported' }], winner: 'rpa', second: 'api' },
  { name: 'clear rules, structured, API confirmed absent, stable screens: RPA 100', traits: clear, systems: [{ api: 'absent', ui: true }], winner: 'rpa', min: 100 },
  { name: 'confirmed API that does not cover the work: RPA', traits: clear, systems: [{ api: 'confirmed-nocover' }], winner: 'rpa', second: 'api' },
  { name: 'clear rules, no system at all: RPA (rule-based)', traits: clear, winner: 'rpa' },
  { name: 'unstable screens and no API: stays with a person for now', traits: { judgment: f(false), physical: f(false) }, systems: [{ api: 'absent', ui: false }], winner: 'human', forNow: true },
  // ---- a confirmed API wins
  { name: 'confirmed API covering the work: API first, RPA second', traits: clear, systems: [{ api: 'confirmed' }], winner: 'api', second: 'rpa', min: 100 },
  { name: 'confirmed API with stable screens too: API wins the tie', traits: clear, systems: [{ api: 'confirmed', ui: true }], winner: 'api', second: 'rpa' },
  { name: 'confirmed API, nothing else known: API', systems: [{ api: 'confirmed' }], winner: 'api', second: 'rpa' },
  { name: 'one of two systems confirmed: RPA, API capped', traits: clear, systems: [{ api: 'confirmed' }, { api: 'unknown' }], winner: 'rpa', second: 'api' },
  { name: 'scanner is not an integration target', traits: clear, systems: [{ kind: 'scanner', api: 'none' }], winner: 'rpa' },
  // ---- AI has to earn its place
  { name: 'structured data, no free text: AI capped, not needed', traits: clear, systems: [{ api: 'unknown' }], winner: 'rpa', ai: false },
  { name: 'paper input, no judgment: AI-assisted with review', traits: { input: f('paper'), judgment: f(false), physical: f(false), rulesComplete: f(true) }, winner: 'ai_assist', human: 'review', ai: true },
  { name: 'unstructured documents: AI-assisted, RPA capped', traits: { input: f('unstructured'), judgment: f(false), physical: f(false) }, systems: [{ api: 'confirmed' }], winner: 'ai_assist', ai: true },
  { name: 'free text without rules: AI-assisted', traits: { language: f(true), rulesComplete: f(false), input: f('semi_structured'), judgment: f(false), physical: f(false) }, winner: 'ai_assist', human: 'review' },
  { name: 'free text but complete structured rules: RPA', traits: { ...clear, language: f(true) }, systems: [{ api: 'unknown' }], winner: 'rpa' },
  { name: 'nothing known and no system: stays with a person for now', winner: 'human', forNow: true, ai: false },
  // ---- agents only with all five conditions
  { name: 'all five agent conditions, no rules, no free text: agent, person approves', traits: { rulesComplete: f(false), input: f('structured'), language: f(false), judgment: f(false), physical: f(false), agent: agentAll }, winner: 'agent', human: 'approve', ai: true },
  { name: 'four of five agent conditions: no agent', traits: { rulesComplete: f(false), input: f('structured'), language: f(false), judgment: f(false), physical: f(false), agent: { ...agentAll, value: f(false) } }, winner: 'human', forNow: true },
  { name: 'agent conditions unknown: never a fallback', traits: { rulesComplete: f(false), input: f('structured'), language: f(false), judgment: f(false), physical: f(false) }, winner: 'human', forNow: true },
  { name: 'clear rules beat an agent', traits: { ...clear, agent: agentAll }, systems: [{ api: 'unknown' }], winner: 'rpa' },
  { name: 'AI assistance beats an agent for free text', traits: { language: f(true), rulesComplete: f(false), input: f('semi_structured'), judgment: f(false), physical: f(false), agent: agentAll }, winner: 'ai_assist' },
  // ---- people
  { name: 'judgment keeps a person deciding, whatever the systems', traits: { ...clear, judgment: f(true) }, systems: [{ api: 'confirmed', ui: true }], winner: 'human', human: 'decide', forNow: false, min: HUMAN_FLOOR },
  { name: 'physical action keeps a person doing it', traits: { physical: f(true) }, winner: 'human', human: 'does_it', forNow: false },
  { name: 'judgment beats document AI', traits: { judgment: f(true), input: f('unstructured') }, winner: 'human', human: 'decide' },
  { name: 'incomplete rules cap RPA: person for now', traits: { rulesComplete: f(false), input: f('structured'), judgment: f(false), physical: f(false), language: f(false) }, systems: [{ api: 'unknown', ui: true }], winner: 'human', forNow: true },
  // ---- approvals
  { name: 'financial change by RPA keeps an approval', traits: { ...clear, write: f('financial') }, systems: [{ api: 'unknown' }], winner: 'rpa', human: 'approve' },
  { name: 'irreversible change through an API keeps an approval', traits: { ...clear, write: f('irreversible') }, systems: [{ api: 'confirmed' }], winner: 'api', human: 'approve' },
  { name: 'record update needs no approval', traits: { ...clear, write: f('record') }, systems: [{ api: 'unknown' }], winner: 'rpa', human: 'none' },
  { name: 'financial document AI: approve beats review', traits: { input: f('paper'), judgment: f(false), physical: f(false), write: f('financial') }, winner: 'ai_assist', human: 'approve' },
];

for (const r of rows) {
  test(`scoring: ${r.name}`, () => {
    const m = build([{ traits: r.traits, systems: r.systems, type: r.type }]);
    const s = scoreStep(m, m.steps[0]);
    const detail = s.scores.map(x => `${x.approach} ${x.score}`).join(', ');
    assert.equal(s.winner, r.winner, detail);
    assert.equal(s.scores[0].approach, r.winner);
    if (r.second) assert.equal(s.scores[1].approach, r.second, detail);
    if (r.human) assert.equal(s.human, r.human);
    if (r.forNow !== undefined) assert.equal(s.forNow, r.forNow, detail);
    if (r.ai !== undefined) assert.equal(s.aiNeeded, r.ai);
    if (r.min !== undefined) assert.ok(s.scores[0].score >= r.min, detail);
    assert.equal(s.scores.length, 5);
    assert.ok(s.scores.every(x => x.score >= 0 && x.score <= 100 && Number.isInteger(x.score)));
    assert.ok(s.reason.length > 10);
    // The others are in score order behind the recommendation.
    for (let i = 2; i < s.scores.length; i++) assert.ok(s.scores[i - 1].score >= s.scores[i].score, detail);
  });
}

test('the weight tables add up to 100 and the limits are what the documentation says', () => {
  for (const [a, w] of Object.entries(WEIGHTS)) assert.equal(Object.values(w).reduce((t, x) => t + x, 0), 100, a);
  assert.deepEqual(COMPLEXITY_PENALTY, { ai_assist: 15, agent: 30 });
  assert.ok(CAPS.apiNotConfirmed < FIT.strong && CAPS.rulesIncomplete < FIT.possible && CAPS.nothingForAi < FIT.possible);
});

test('the same model always gives the same result, and the input is not changed', () => {
  const m = build([{ traits: clear, systems: [{ api: 'reported' }] }, { traits: { input: f('paper') } }, { type: 'service' }]);
  const before = JSON.stringify(m);
  const a = JSON.stringify(assessProcess(m)), b = JSON.stringify(assessProcess(JSON.parse(before)));
  assert.equal(a, b);
  assert.equal(JSON.stringify(m), before);
});

test('a score is its factors, less the penalty, within the caps', () => {
  const m = build([{ traits: clear, systems: [{ api: 'reported', ui: true }] }]);
  const s = scoreStep(m, m.steps[0]);
  const rpa = s.scores.find(x => x.approach === 'rpa')!, api = s.scores.find(x => x.approach === 'api')!, ai = s.scores.find(x => x.approach === 'ai_assist')!;
  assert.equal(rpa.score, 100);
  assert.equal(Math.round(rpa.factors.reduce((t, x) => t + x.points, 0)), rpa.raw);
  assert.equal(api.raw, 78);
  assert.equal(api.score, CAPS.apiNotConfirmed);
  assert.match(api.caps[0].reason, /No API is confirmed/);
  assert.ok(ai.score <= CAPS.nothingForAi);
  assert.match(ai.caps[0].reason, /rules can do this without AI/);
  assert.equal(ai.penalty, 15);
  const rules = rpa.factors.find(x => x.id === 'rules')!;
  assert.deepEqual([rules.weight, rules.value, rules.known, rules.sources.length], [35, 1, true, 1]);
  assert.equal(s.aiUnnecessary, true);
  assert.equal(s.confidence, 'high');
  assert.equal(s.apiWouldWin, true, 'a confirmed API would beat even stable screens');
});

test('unknown facts lower confidence, are listed as questions, and never block a result', () => {
  const m = build([{ systems: [{ api: 'none' }] }]);
  const s = scoreStep(m, m.steps[0]);
  assert.equal(s.winner, 'rpa');
  assert.equal(s.confidence, 'low');
  assert.deepEqual(s.unknowns.map(u => u.key), ['trait:rulesComplete', 'trait:input', 'trait:judgment', 'trait:physical', 'trait:language', 'screens:sys-0-0', 'api:sys-0-0']);
  assert.match(s.questions[0].question, /Confirm whether System 1 has an API that covers "Post supplier invoice"/);
  assert.equal(s.apiWouldWin, true);
});

test('a person stating a fact changes the scores at once', () => {
  let m = build([{ traits: clear, systems: [{ api: 'absent' }] }]);
  assert.equal(scoreStep(m, m.steps[0]).winner, 'rpa');
  m = setSystemUiStable(m, { systemId: 'sys-0-0', value: false }).model;
  assert.equal(scoreStep(m, m.steps[0]).winner, 'human');
  m = setSystemUiStable(m, { systemId: 'sys-0-0', value: true }).model;
  m = setStepTrait(m, { stepId: 's-0', trait: 'judgment', value: true }).model;
  const s = scoreStep(m, m.steps[0]);
  assert.equal(s.winner, 'human');
  assert.equal(s.scores[0].floor?.to, HUMAN_FLOOR);
  assert.equal(s.scores[0].factors[0].status, 'user-confirmed');
});

test('API coverage needs a word particular to the step', () => {
  const m = build([{ name: 'Scan paper invoice', traits: clear, systems: [{ kind: 'email', api: 'confirmed' }] }]);
  m.meta.name = 'Vendor invoice processing';
  m.systems[0].access[0].operations = ['Read invoices from the AP mailbox'];
  assert.equal(scoreStep(m, m.steps[0]).winner, 'rpa', '"invoice" alone does not show coverage');
  m.systems[0].access[0].operations = ['Scan documents to the mailbox'];
  assert.equal(scoreStep(m, m.steps[0]).winner, 'api');
});

// ---------------------------------------------------------------- the process

const rpaStep = (effort?: number, share?: number): StepSpec => ({ name: 'Check totals', traits: { ...clear, ...(effort !== undefined ? { effortMinutes: f(effort) } : {}), ...(share !== undefined ? { sharePercent: f(share) } : {}) }, systems: [{ api: 'unknown' }] });
const apiStep: StepSpec = { traits: clear, systems: [{ api: 'confirmed' }] };
const aiStep = (effort?: number, share?: number): StepSpec => ({ name: 'Read paper invoice', traits: { input: f('paper'), judgment: f(false), physical: f(false), ...(effort !== undefined ? { effortMinutes: f(effort) } : {}), ...(share !== undefined ? { sharePercent: f(share) } : {}) } });
const humanStep = (effort?: number, share?: number): StepSpec => ({ name: 'Approve exception', traits: { judgment: f(true), ...(effort !== undefined ? { effortMinutes: f(effort) } : {}), ...(share !== undefined ? { sharePercent: f(share) } : {}) } });

test('the process gets a ranked outcome: RPA first where no API is confirmed, API second, AI third', () => {
  const r = assessProcess(build([rpaStep(), rpaStep(), rpaStep(), apiStep, aiStep(), humanStep(), { type: 'service' }]));
  assert.equal(r.assessed, 6);
  assert.equal(r.candidates, 5, 'the step that needs judgment is not part of the average');
  assert.equal(r.alreadyAutomated, 1);
  assert.deepEqual(r.ranking.map(x => x.approach), ['rpa', 'api', 'ai_assist', 'agent']);
  assert.deepEqual(r.ranking.map(x => x.rank), [1, 2, 3, 4]);
  assert.ok(r.ranking[0].score > r.ranking[1].score && r.ranking[1].score > r.ranking[2].score);
  assert.deepEqual(r.counts, { rpa: 3, api: 1, ai_assist: 1, agent: 0, human: 1 });
  assert.equal(r.lead, 'rpa');
  assert.equal(r.verdict, 'RPA-led automation');
  assert.equal(r.split, 'Of 6 steps people do today: Rule-based RPA for 3, API integration for 1, AI-assisted automation for 1, 1 stays with people. 1 step is already done by a system.');
  assert.match(r.ranking[0].why, /^Best fit for 3 of 6 steps; it could do 4\. Its strongest ground: /);
  assert.match(r.ranking[1].toWin, /If the APIs of System 1, System 2, System 3 are confirmed for this work, API integration becomes the best fit for 3 more steps\./);
  assert.equal(r.aiSteps, 1);
  assert.equal(Math.round(r.automationFit * 100), 83);
});

test('the summary says in plain words why the approach is proposed', () => {
  const r = assessProcess(build([rpaStep(), rpaStep(), apiStep, aiStep(), humanStep()]));
  assert.deepEqual(r.narrative.map(x => x.title), ['Why RPA-led automation', 'Why the others rank lower', 'Where AI is needed', 'What stays with people', 'How firm this is']);
  assert.match(r.narrative[0].text, /^Rule-based RPA scores \d+ out of 100 across the 4 steps open to automation, the highest of the four approaches\. Best fit for 2 of 5 steps/);
  assert.match(r.narrative[1].text, /API integration ranks second with \d+\./);
  assert.match(r.narrative[2].text, /^AI is needed in 1 of 5 steps: "Read paper invoice"\./);
  assert.match(r.narrative[3].text, /1 step needs a person because of judgment, accountability or physical work: "Approve exception"\./);
  assert.match(r.narrative[4].text, /the same facts always give the same result\.$/);
  for (const p of r.narrative) assert.doesNotMatch(p.text, /undefined|NaN|\.\.|\s\./, p.text);

  // The same explanation as data, for the screen.
  assert.match(r.takeaway, /^Rule-based RPA is the best fit for 2 of the 4 steps open to automation, mainly because /);
  assert.ok(r.drivers.length >= 2 && r.drivers.every(d => d.steps === 2 && !d.text.endsWith('.')));
  assert.deepEqual(r.apiSwitch, { systems: ['System 1', 'System 2'], steps: 2 });
  assert.deepEqual([r.aiStepIds, r.mustStayStepIds, r.forNowStepIds], [['s-3'], ['s-4'], []]);
  assert.equal(r.ranking[1].heldBack?.steps !== undefined && r.ranking[0].strength !== null, true);

  const none = assessProcess(build([rpaStep(), apiStep]));
  assert.match(none.narrative.find(x => x.title === 'Where AI is needed')!.text, /^AI is not needed for any step\./);
  const stuck = assessProcess(build([{}, {}]));
  assert.equal(stuck.lead, null);
  assert.equal(stuck.verdict, 'Keep the process with people for now');
  assert.equal(stuck.narrative[0].title, 'Why not automate yet');
});

test('an API-ready process is API-led, and the ranking follows the scores', () => {
  const r = assessProcess(build([apiStep, apiStep, rpaStep()]));
  assert.equal(r.lead, 'api');
  assert.equal(r.verdict, 'API-led integration');
  assert.deepEqual(r.ranking.slice(0, 2).map(x => x.approach), ['api', 'rpa']);
});

test('the questions that matter most are counted across steps', () => {
  const r = assessProcess(build([{ systems: [{ api: 'none' }] }, { systems: [{ api: 'none' }] }, rpaStep()]));
  assert.equal(r.confidence, 'low');
  assert.deepEqual(r.keyQuestions.slice(0, 2).map(q => [q.key, q.steps]), [['trait:input', 2], ['trait:judgment', 2]]);
  assert.equal(r.questions.length, 3);
});

test('hours come from volume, effort and share; AI steps count as a range; money needs an entered rate', () => {
  const m = build([rpaStep(10, 100), aiStep(6, 20), humanStep(20, 50)], { volume: [9000, 10000] });
  const r = assessProcess(m);
  assert.ok(r.hours.computable);
  assert.deepEqual(r.hours.value!.today.map(Math.round), [Math.round(108000 * 21.2 / 60), Math.round(120000 * 21.2 / 60)]);
  assert.deepEqual(r.hours.value!.automatable.map(Math.round), [Math.round(108000 * 10 / 60), Math.round(120000 * 11.2 / 60)]);
  assert.deepEqual(r.potential.value!.map(x => Math.round(x * 1000)), [Math.round(10 / 21.2 * 1000), Math.round(11.2 / 21.2 * 1000)]);
  assert.deepEqual(r.money, { computable: false, reason: 'No cost rate has been entered.' });
  const priced = assessProcess(m, { rate: { amount: 2, currency: 'EUR', enteredBy: 'ap@example.com' } });
  assert.equal(priced.money.value!.currency, 'EUR');
  assert.deepEqual(assessProcess(build([rpaStep()])).hours, { computable: false, reason: 'The process volume is not known.' });
  assert.deepEqual(yearlyVolume(build([], { volume: 100, unit: 'cases/week' })), { computable: true, value: [5200, 5200] });
  assert.equal(yearlyVolume(build([], { volume: 20, unit: 'cases' })).computable, false);
});

test('cautions fire at their named thresholds', () => {
  const rework = assessProcess(build([{ traits: { ...clear, rework: f(true) } }, rpaStep(), rpaStep(), rpaStep(), rpaStep()]));
  assert.equal(rework.cautions.find(c => c.id === 'redesign_first')!.fired, true);
  const unstable = assessProcess(build([{ traits: { rulesComplete: f(false) } }, rpaStep()]));
  assert.equal(unstable.cautions.find(c => c.id === 'hold_for_instability')!.fired, true);
  const small = assessProcess(build([rpaStep(5, 100)], { volume: 100, unit: 'cases/year' }));
  assert.equal(small.cautions.find(c => c.id === 'not_worth_automating')!.fired, true);
  assert.equal(assessProcess(build([rpaStep(5, 100)], { volume: 1000, unit: 'cases/week' })).cautions.some(c => c.fired), false);
});

test('the gold AP model: RPA-led, no agent anywhere, API second with the systems to confirm', () => {
  const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
  const r = assessProcess(gold);
  assert.equal(r.lead, 'rpa');
  assert.equal(r.ranking[0].approach, 'rpa');
  assert.equal(r.ranking[1].approach, 'api');
  assert.equal(r.counts.agent, 0);
  assert.equal(r.aiSteps, 0);
  assert.match(r.ranking[1].toWin, /SAP S\/4HANA/);
  assert.equal(scoreOf(r.steps.find(s => !s.alreadyAutomated)!, 'agent') <= CAPS.agentConditionUnknown, true);
});

test('overrides need a rationale, survive storage, and leave the scoring answer visible', () => {
  const m = build([rpaStep()]);
  const s = scoreStep(m, m.steps[0]);
  assert.throws(() => withOverride(emptyDecisions(), s, { approach: 'human', rationale: '  ', by: 'a' }), DecisionError);
  let d = withOverride(emptyDecisions(), s, { approach: 'human', rationale: 'Audit wants a person', by: 'lead@example.com', at: '2026-11-12T00:00:00Z' });
  d = withRate(d, { amount: 30, currency: 'EUR', enteredBy: 'lead@example.com' });
  const back = decisionsFromEntries(JSON.parse(JSON.stringify(decisionsToEntries(d))));
  assert.deepEqual(back, d);
  assert.deepEqual(effectiveApproach(s, back), { approach: 'human', override: back.overrides[s.stepId] });
  assert.equal(s.winner, 'rpa');
  assert.deepEqual(withOverride(back, s, { approach: 'rpa', rationale: '', by: 'a' }).overrides, {});
  assert.deepEqual(withoutOverride(back, s.stepId).overrides, {});
  assert.throws(() => withRate(d, { amount: 0, currency: 'EUR', enteredBy: 'x' }), DecisionError);
  assert.deepEqual(decisionsFromEntries('nonsense'), emptyDecisions());
});

test('no monetary literal appears in the assessment code', () => {
  const dir = new URL('./', import.meta.url);
  const money = /([$€£₹¥]\s?\d)|(\d[\d,.]*\s?(USD|EUR|GBP|INR|dollars?|euros?|rupees?)\b)|\b(hourly_?cost|cost_?per_?hour|DEFAULT_[A-Z_]*COST)\b/i;
  for (const file of readdirSync(dir).filter((x: string) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
    assert.doesNotMatch(readFileSync(new URL(file, dir), 'utf8'), money, `${file} contains a monetary literal`);
  }
});

test('robots not allowed on a system\'s screens: RPA is ruled out there, and a confirmed API takes over', async () => {
  const { setSystemUiAllowed, setSystemApi } = await import('../processModel/patch.ts');
  const traits: StepTraits = { rulesComplete: f(true), input: f('structured'), judgment: f(false), physical: f(false), language: f(false), write: f('record') };
  let m = build([{ traits, systems: [{ api: 'unknown', ui: true }] }]);
  assert.equal(scoreStep(m, m.steps[0]).winner, 'rpa');
  m = setSystemUiAllowed(m, { systemId: m.systems[0].id, value: false }).model;
  const blocked = scoreStep(m, m.steps[0]);
  assert.equal(scoreOf(blocked, 'rpa'), 0);
  assert.notEqual(blocked.winner, 'rpa');
  assert.ok(blocked.scores.find(x => x.approach === 'rpa')!.caps.some(c => /not allowed/.test(c.reason)));
  assert.equal(blocked.winner, 'api', 'with the screens closed, integration is the route');
  assert.ok(blocked.questions.some(q => /API/.test(q.question)), 'and the API has to be confirmed');
  m = setSystemApi(m, { systemId: m.systems[0].id, access: 'confirmed' }).model;
  assert.equal(scoreStep(m, m.steps[0]).winner, 'api');
});
