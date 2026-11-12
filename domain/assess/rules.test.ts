import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AccessMethod, Fact, ProcessModel, Step, StepTraits, SystemRef } from '../processModel/types.ts';
import { emptyModel } from '../processModel/empty.ts';
import { validateModel } from '../processModel/validate.ts';
import { setStepTrait, setSystemUiStable } from '../processModel/patch.ts';
import { evaluateStep, LADDER, type AiNeed, type HumanPoint, type Mechanism } from './rules.ts';

const src = [{ sourceId: 'sop', locator: { section: '6' }, excerpt: 'quoted text' }];
const stated = <T>(value: T): Fact<T> => ({ value, status: 'stated', sources: src });
const inferred = <T>(value: T): Fact<T> => ({ value, status: 'inferred', sources: src });

type Api = 'confirmed' | 'confirmed-nocover' | 'confirmed-noops' | 'reported' | 'unknown' | 'absent' | 'none';
interface Sys { kind?: SystemRef['kind']; api: Api; ui?: boolean | null }

function build(step: Partial<Step> & { traits?: StepTraits }, systems: Sys[] = []): ProcessModel {
  const m = emptyModel('Case');
  m.systems = systems.map((s, i) => {
    const access: AccessMethod[] = [];
    const op = s.api === 'confirmed-nocover' ? ['Read vendor master'] : s.api === 'confirmed-noops' ? [] : ['Post supplier invoice'];
    const status = s.api.startsWith('confirmed') ? 'confirmed' : s.api === 'absent' ? 'confirmed_absent' : s.api;
    if (s.api !== 'none') access.push({ method: 'api', name: 'API_SUPPLIERINVOICE', operations: op, access: status as AccessMethod['access'], status: 'stated', sources: src });
    const sys: SystemRef = { id: `sys-${i}`, name: `System ${i + 1}`, kind: s.kind ?? 'erp', inScope: true, access, status: 'stated', sources: src };
    if (s.ui !== undefined) sys.uiStable = s.ui === null ? { value: null, status: 'unknown', sources: [] } : stated(s.ui);
    return sys;
  });
  m.steps = [{
    id: 's-1', name: step.name ?? 'Post supplier invoice', description: '', roleIds: [], systemIds: m.systems.map(s => s.id),
    taskType: step.taskType ?? 'user', inputs: [], outputs: [], ruleIds: [], exceptionIds: [], status: 'stated', sources: src,
    ...(step.traits ? { traits: step.traits } : {}),
  }];
  assert.deepEqual(validateModel(m).issues.filter(i => i.severity === 'error'), [], 'fixture is valid');
  return m;
}

const structuredRules: StepTraits = { rulesComplete: stated(true), input: stated('structured') };
const allAgent = (v = true) => ({ ambiguity: stated(v), adaptive: stated(true), toolChoice: stated(true), value: stated(true), controllable: stated(true) });

interface Row {
  name: string;
  step?: Partial<Step>;
  traits?: StepTraits;
  systems?: Sys[];
  mechanism: Mechanism;
  ai?: AiNeed;
  human?: HumanPoint;
  aiUnnecessary?: boolean;
  unknown?: string[];
  question?: RegExp;
}

const rows: Row[] = [
  // ---- the six profiles the old engines got wrong (product plan 3.1), with the corrected outcome
  { name: 'V1#1 structured rule-based check on an API-ready system: rules, AI unnecessary (not RPA)', traits: structuredRules, systems: [{ api: 'confirmed' }], mechanism: 'rules', ai: 'no', aiUnnecessary: true },
  { name: 'V1#1b API-ready data transfer: API, not RPA', traits: { input: stated('structured'), rulesComplete: stated(false) }, systems: [{ api: 'confirmed' }], mechanism: 'api', aiUnnecessary: true },
  { name: 'V1#2 personal data does not block an API-ready step', traits: { input: stated('structured'), physical: stated(false), judgment: stated(false) }, systems: [{ api: 'confirmed' }], mechanism: 'api' },
  { name: 'V1#3 legacy system, API confirmed absent, stable UI: RPA bridge', traits: { input: stated('structured') }, systems: [{ api: 'absent', ui: true }], mechanism: 'rpa', ai: 'no', aiUnnecessary: true },
  { name: 'V1#5 high judgment: keep human, person decides', traits: { judgment: stated(true), input: stated('structured') }, systems: [{ api: 'confirmed' }], mechanism: 'keep_human', human: 'decide', ai: 'no' },
  { name: 'V1#6 fully deterministic structured step: AI unnecessary', traits: { ...structuredRules, language: stated(false) }, mechanism: 'rules', aiUnnecessary: true, ai: 'no' },
  // ---- V2 defects with the corrected outcome
  { name: 'V2: undocumented API is a candidate, not ready', traits: { input: stated('structured') }, systems: [{ api: 'reported' }], mechanism: 'api_candidate', ai: 'undecided', question: /Confirm whether System 1 has an API that covers "Post supplier invoice"/ },
  { name: 'V2: an agent is never the fallback', traits: { judgment: stated(false), physical: stated(false), rulesComplete: stated(false), language: stated(false), input: stated('structured') }, mechanism: 'no_option', human: 'does_it', ai: 'no' },
  { name: 'V2: API and RPA are not both attached when the API is confirmed', traits: { input: stated('structured') }, systems: [{ api: 'confirmed', ui: true }], mechanism: 'api' },
  { name: 'V2: no eligible automation says keep with a person', traits: {}, mechanism: 'no_option', human: 'does_it' },

  // ---- rung 0
  { name: 'service task is already automated', step: { taskType: 'service' }, mechanism: 'already_automated', aiUnnecessary: true },
  { name: 'service task wins over rework', step: { taskType: 'service' }, traits: { rework: stated(true) }, mechanism: 'already_automated' },
  // ---- rung 1
  { name: 'rework is eliminated first', traits: { rework: stated(true), ...structuredRules }, mechanism: 'eliminate', ai: 'no', aiUnnecessary: false },
  { name: 'rework beats judgment', traits: { rework: stated(true), judgment: stated(true) }, mechanism: 'eliminate' },
  { name: 'rework false continues down', traits: { rework: stated(false), ...structuredRules }, mechanism: 'rules' },
  { name: 'rework unknown is listed as an unknown', traits: structuredRules, mechanism: 'rules', unknown: ['traits.rework'] },
  { name: 'rework inferred still fires', traits: { rework: inferred(true) }, mechanism: 'eliminate' },
  { name: 'rework status unknown does not fire', traits: { rework: { value: null, status: 'unknown', sources: [] }, ...structuredRules }, mechanism: 'rules', unknown: ['traits.rework'] },
  // ---- rung 2
  { name: 'physical action keeps a person doing it', traits: { physical: stated(true) }, mechanism: 'keep_human', human: 'does_it' },
  { name: 'physical and judgment: person decides', traits: { physical: stated(true), judgment: stated(true) }, mechanism: 'keep_human', human: 'decide' },
  { name: 'judgment beats complete rules', traits: { judgment: stated(true), ...structuredRules }, mechanism: 'keep_human' },
  { name: 'judgment beats a confirmed API', traits: { judgment: stated(true) }, systems: [{ api: 'confirmed' }], mechanism: 'keep_human' },
  { name: 'judgment beats document extraction', traits: { judgment: stated(true), input: stated('unstructured') }, mechanism: 'keep_human' },
  { name: 'judgment unknown is listed above rules', traits: structuredRules, mechanism: 'rules', unknown: ['traits.judgment', 'traits.physical'] },
  { name: 'physical false and judgment false do not fire', traits: { physical: stated(false), judgment: stated(false), ...structuredRules }, mechanism: 'rules' },
  // ---- rung 3
  { name: 'complete rules and structured input: rules', traits: structuredRules, mechanism: 'rules', human: 'none' },
  { name: 'complete rules, semi-structured input: not rules', traits: { rulesComplete: stated(true), input: stated('semi_structured') }, mechanism: 'no_option' },
  { name: 'complete rules, unknown input: not rules, input unknown listed', traits: { rulesComplete: stated(true) }, mechanism: 'no_option', unknown: ['traits.input'] },
  { name: 'incomplete rules, structured, no system: keep with a person', traits: { rulesComplete: stated(false), input: stated('structured') }, mechanism: 'no_option' },
  { name: 'rules unknown, structured: listed', traits: { input: stated('structured') }, mechanism: 'no_option', unknown: ['traits.rulesComplete'] },
  { name: 'complete rules on paper go to extraction', traits: { rulesComplete: stated(true), input: stated('paper') }, mechanism: 'extraction', ai: 'yes', human: 'review' },
  { name: 'rules beat a confirmed API', traits: structuredRules, systems: [{ api: 'confirmed' }], mechanism: 'rules' },
  { name: 'rules beat an unknown API', traits: structuredRules, systems: [{ api: 'unknown' }], mechanism: 'rules' },
  { name: 'rules with an inferred rule fact: medium confidence', traits: { rulesComplete: inferred(true), input: stated('structured') }, mechanism: 'rules' },
  // ---- rung 4
  { name: 'confirmed API covering the operation', traits: { input: stated('structured') }, systems: [{ api: 'confirmed' }], mechanism: 'api', human: 'none' },
  { name: 'confirmed API with unknown input still integrates', systems: [{ api: 'confirmed' }], mechanism: 'api' },
  { name: 'confirmed API not covering the operation is a candidate', traits: { input: stated('structured') }, systems: [{ api: 'confirmed-nocover' }], mechanism: 'api_candidate' },
  { name: 'confirmed API without listed operations is a candidate', traits: { input: stated('structured') }, systems: [{ api: 'confirmed-noops' }], mechanism: 'api_candidate' },
  { name: 'one of two systems has a confirmed API', traits: { input: stated('structured') }, systems: [{ api: 'unknown' }, { api: 'confirmed' }], mechanism: 'api' },
  { name: 'scanner is not an integration target', traits: { input: stated('structured') }, systems: [{ kind: 'scanner', api: 'none' }], mechanism: 'no_option' },
  { name: 'unstructured input skips the API rung', traits: { input: stated('unstructured') }, systems: [{ api: 'confirmed' }], mechanism: 'extraction' },
  // ---- rung 4a
  { name: 'reported API: candidate with a question', systems: [{ api: 'reported' }], mechanism: 'api_candidate', question: /System 1/ },
  { name: 'unknown API: candidate', systems: [{ api: 'unknown' }], mechanism: 'api_candidate', ai: 'undecided' },
  { name: 'no access recorded at all: candidate', systems: [{ api: 'none' }], mechanism: 'api_candidate' },
  { name: 'two unconfirmed systems: two questions', systems: [{ api: 'unknown' }, { api: 'reported' }], mechanism: 'api_candidate' },
  { name: 'absent on one, unknown on the other: candidate for the unknown one', systems: [{ api: 'absent', ui: true }, { api: 'unknown' }], mechanism: 'api_candidate' },
  // ---- rung 5
  { name: 'API absent, UI stable: RPA', systems: [{ api: 'absent', ui: true }], mechanism: 'rpa' },
  { name: 'API absent, UI unknown: RPA with the UI question', systems: [{ api: 'absent' }], mechanism: 'rpa', unknown: ['systems.sys-0.uiStable'] },
  { name: 'API absent, UI stated unknown: RPA with the question', systems: [{ api: 'absent', ui: null }], mechanism: 'rpa', unknown: ['systems.sys-0.uiStable'] },
  { name: 'API absent, UI unstable: no RPA', traits: { language: stated(false) }, systems: [{ api: 'absent', ui: false }], mechanism: 'no_option' },
  { name: 'API absent on both systems, both stable: RPA', systems: [{ api: 'absent', ui: true }, { api: 'absent', ui: true }], mechanism: 'rpa' },
  { name: 'RPA is not AI', systems: [{ api: 'absent', ui: true }], mechanism: 'rpa', ai: 'no' },
  // ---- rung 6
  { name: 'unstructured input: extraction with review', traits: { input: stated('unstructured') }, mechanism: 'extraction', ai: 'yes', human: 'review', aiUnnecessary: false },
  { name: 'paper input: extraction', traits: { input: stated('paper') }, mechanism: 'extraction' },
  { name: 'paper with a physical action stays human', traits: { input: stated('paper'), physical: stated(true) }, mechanism: 'keep_human' },
  { name: 'structured input does not extract', traits: { input: stated('structured'), rulesComplete: stated(false), language: stated(false) }, mechanism: 'no_option' },
  // ---- rung 7
  { name: 'free text without rules: AI assistance', traits: { language: stated(true), rulesComplete: stated(false), input: stated('semi_structured') }, mechanism: 'ai_assist', ai: 'yes', human: 'review' },
  { name: 'free text, rules unknown: AI assistance', traits: { language: stated(true), input: stated('semi_structured') }, mechanism: 'ai_assist' },
  { name: 'free text with complete structured rules: rules', traits: { language: stated(true), ...structuredRules }, mechanism: 'rules' },
  { name: 'free text with complete rules but semi-structured input: not AI', traits: { language: stated(true), rulesComplete: stated(true), input: stated('semi_structured') }, mechanism: 'no_option' },
  { name: 'language unknown listed', traits: { input: stated('semi_structured'), rulesComplete: stated(false) }, mechanism: 'no_option', unknown: ['traits.language'] },
  // ---- rung 8
  { name: 'all five agent conditions: bounded agent, person approves', traits: { language: stated(false), input: stated('semi_structured'), rulesComplete: stated(false), agent: allAgent() }, mechanism: 'agent', ai: 'yes', human: 'approve' },
  { name: 'four of five agent conditions: no agent', traits: { language: stated(false), input: stated('semi_structured'), agent: allAgent(false) }, mechanism: 'no_option' },
  { name: 'agent condition missing: no agent', traits: { language: stated(false), input: stated('semi_structured'), agent: { ambiguity: stated(true) } }, mechanism: 'no_option' },
  { name: 'AI assistance is preferred to an agent', traits: { language: stated(true), input: stated('semi_structured'), agent: allAgent() }, mechanism: 'ai_assist' },
  { name: 'rules are preferred to an agent', traits: { ...structuredRules, agent: allAgent() }, mechanism: 'rules' },
  // ---- human approval overlay (INT-005 to INT-007)
  { name: 'financial write through an API needs approval', traits: { input: stated('structured'), write: stated('financial') }, systems: [{ api: 'confirmed' }], mechanism: 'api', human: 'approve' },
  { name: 'irreversible write by rules needs approval', traits: { ...structuredRules, write: stated('irreversible') }, mechanism: 'rules', human: 'approve' },
  { name: 'record write needs no approval', traits: { ...structuredRules, write: stated('record') }, mechanism: 'rules', human: 'none' },
  { name: 'financial write by a person stays decide', traits: { judgment: stated(true), write: stated('financial') }, mechanism: 'keep_human', human: 'decide' },
  { name: 'financial extraction: approve beats review', traits: { input: stated('paper'), write: stated('financial') }, mechanism: 'extraction', human: 'approve' },
  { name: 'agent with financial write still approve', traits: { input: stated('semi_structured'), rulesComplete: stated(false), language: stated(false), write: stated('financial'), agent: allAgent() }, mechanism: 'agent', human: 'approve' },
];

for (const r of rows) {
  test(`ladder: ${r.name}`, () => {
    const m = build({ ...(r.step ?? {}), ...(r.traits ? { traits: r.traits } : {}) }, r.systems ?? []);
    const res = evaluateStep(m, m.steps[0]);
    assert.equal(res.mechanism, r.mechanism, `${res.label}: ${res.reasons.map(x => x.text).join(' | ')}`);
    if (r.ai) assert.equal(res.aiNeeded, r.ai);
    if (r.human) assert.equal(res.human, r.human);
    if (r.aiUnnecessary !== undefined) assert.equal(res.aiUnnecessary, r.aiUnnecessary);
    for (const u of r.unknown ?? []) assert.ok(res.unknowns.some(x => x.path === u), `unknown ${u} in ${res.unknowns.map(x => x.path)}`);
    if (r.question) assert.ok(res.questions.some(q => r.question!.test(q.question)), res.questions.map(q => q.question).join(' | '));
    // Every rung above the chosen one is reported as rejected, with a reason.
    const above = LADDER.slice(0, LADDER.findIndex(x => x.id === res.rung) === -1 ? LADDER.length : LADDER.findIndex(x => x.id === res.rung));
    assert.deepEqual(res.rejected.map(x => x.rung), above.map(x => x.id));
    assert.ok(res.rejected.every(x => x.reason.length > 0));
    assert.ok(res.reasons.length > 0 && res.reasons.every(x => x.text.length > 0));
  });
}

test('the table has at least 60 cases', () => assert.ok(rows.length >= 60, String(rows.length)));

test('reasons cite the facts and their sources', () => {
  const m = build({ traits: structuredRules });
  const r = evaluateStep(m, m.steps[0]);
  const facts = r.reasons.flatMap(x => x.facts);
  assert.deepEqual(facts.map(f => f.path).sort(), ['traits.input', 'traits.rulesComplete']);
  assert.ok(facts.every(f => f.sources.length === 1 && f.status === 'stated'));
  assert.equal(r.confidence, 'low', 'rework, physical and judgment are still unknown');
  const full = build({ traits: { ...structuredRules, rework: stated(false), physical: stated(false), judgment: stated(false) } });
  assert.equal(evaluateStep(full, full.steps[0]).confidence, 'high');
  const weak = build({ traits: { rulesComplete: inferred(true), input: stated('structured'), rework: stated(false), physical: stated(false), judgment: stated(false) } });
  assert.equal(evaluateStep(weak, weak.steps[0]).confidence, 'medium');
});

test('a person stating a trait changes the result and keeps the step itself unchanged', () => {
  let m = build({}, [{ api: 'absent' }]);
  assert.equal(evaluateStep(m, m.steps[0]).mechanism, 'rpa');
  m = setSystemUiStable(m, { systemId: 'sys-0', value: false }).model;
  assert.equal(evaluateStep(m, m.steps[0]).mechanism, 'no_option');
  m = setStepTrait(m, { stepId: 's-1', trait: 'judgment', value: true }).model;
  const r = evaluateStep(m, m.steps[0]);
  assert.equal(r.mechanism, 'keep_human');
  assert.equal(r.reasons[0].facts[0].status, 'user-confirmed');
  assert.equal(m.steps[0].status, 'stated', 'the step was not edited');
  m = setStepTrait(m, { stepId: 's-1', trait: 'agent.ambiguity', value: true }).model;
  assert.equal(m.steps[0].traits?.agent?.ambiguity?.value, true);
  m = setStepTrait(m, { stepId: 's-1', trait: 'judgment', value: null }).model;
  assert.equal(m.steps[0].traits?.judgment?.status, 'unknown');
  assert.deepEqual(validateModel(m).issues.filter(i => i.severity === 'error'), []);
});

test('invalid traits are rejected by validation', () => {
  const m = build({ traits: structuredRules });
  (m.steps[0].traits as any).input = stated('handwritten');
  (m.steps[0].traits as any).mood = stated(true);
  const codes = validateModel(m).issues.filter(i => i.severity === 'error').map(i => i.code);
  assert.ok(codes.includes('FACT_VALUE') && codes.includes('TRAITS'));
});

test('the gold AP model evaluates every step without throwing and never picks an agent', async () => {
  const { readFileSync } = await import('node:fs');
  const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
  const results = gold.steps.map(s => evaluateStep(gold, s));
  assert.equal(results.length, gold.steps.length);
  assert.ok(results.every(r => r.mechanism !== 'agent'));
  // Without traits, the systems with unconfirmed APIs lead to candidates and questions, not to RPA or AI.
  assert.ok(results.every(r => r.aiNeeded !== 'yes'));
  assert.ok(results.some(r => r.mechanism === 'api_candidate' && r.questions.length > 0));
});

test('an API covers a step only through words particular to that step, not words common to the process', () => {
  const m = build({ name: 'Scan paper invoice', traits: { input: stated('structured') } }, [{ kind: 'email', api: 'confirmed' }]);
  m.meta.name = 'Vendor invoice processing';
  m.systems[0].access[0].operations = ['Read invoices from the AP mailbox'];
  assert.equal(evaluateStep(m, m.steps[0]).mechanism, 'api_candidate', '"invoice" alone does not show coverage');
  m.systems[0].access[0].operations = ['Scan documents to the mailbox'];
  assert.equal(evaluateStep(m, m.steps[0]).mechanism, 'api', '"scan" does');
  m.systems[0].access[0].access = 'unknown';
  assert.match(evaluateStep(m, m.steps[0]).reasons[0].text, /may have an API \(API_SUPPLIERINVOICE\), but nobody has confirmed it\./);
});
