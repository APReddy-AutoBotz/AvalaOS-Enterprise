// The step assessment: a deterministic scoring model.
//
// Every step a person does today gets a 0-100 score for each approach: rule-based RPA, API
// integration, AI-assisted automation, agentic AI, and keeping it with a person. A score is a sum
// of weighted factors read from the facts in the Process Model, then limited by caps (things that
// rule an approach out) and reduced by a fixed complexity penalty for AI. The weights, values,
// caps and penalties are the tables below; nothing else decides the result, and no AI is involved.
// The same model always gives the same scores. An unknown fact gets a middle value and lowers the
// confidence; it never blocks a result.
import type { AccessMethod, Fact, InputForm, ProcessModel, SourceRef, Step, StepTraits, SystemRef, WriteImpact } from '../processModel/types.ts';

export const MODEL_VERSION = 'assess-scoring-2026-11';

export type Approach = 'rpa' | 'api' | 'ai_assist' | 'agent' | 'human';
/** Automation approaches. On equal scores the earlier one wins: a confirmed API, then RPA, then AI. */
export const AUTOMATION: Approach[] = ['api', 'rpa', 'ai_assist', 'agent'];
export const APPROACH_LABEL: Record<Approach, string> = {
  rpa: 'Rule-based RPA', api: 'API integration', ai_assist: 'AI-assisted automation', agent: 'Agentic AI', human: 'Keep with a person',
};

/** Score bands. Below "possible", an approach is not recommended for the step. */
export const FIT = { strong: 70, possible: 50 } as const;

/** Factor weights per approach; each column adds up to 100. */
export const WEIGHTS = {
  rpa: { rules: 35, input: 25, screens: 25, noJudgment: 15 },
  api: { interface: 40, rules: 25, input: 20, noJudgment: 15 },
  ai_assist: { needsReading: 50, rulesGap: 20, noJudgment: 15, reviewable: 15 },
  agent: { ambiguity: 20, adaptive: 20, toolChoice: 20, value: 20, controllable: 20 },
  human: { judgment: 45, physical: 30, rulesGap: 15, inputNotReady: 10 },
} as const;

/** How well each state of a fact suits an approach, 0 to 1. "unknown" is deliberately in the middle. */
export const VALUES = {
  rules: { complete: 1, unknown: 0.5, incomplete: 0.15 },
  input: { structured: 1, semi_structured: 0.6, unknown: 0.5, unstructured: 0.15, paper: 0 },
  screens: { stable: 1, unknown: 0.7, none: 0.3, unstable: 0.1 },
  noJudgment: { no: 1, unknown: 0.6, yes: 0 },
  interfacePerSystem: { covered: 1, confirmed_other: 0.5, reported: 0.45, unknown: 0.25, absent: 0 },
  // The need for AI has to be shown: unknown counts for little here, unlike the middle value elsewhere.
  readingByInput: { unstructured: 1, paper: 1, semi_structured: 0.6, unknown: 0.15, structured: 0 },
  readingByLanguage: { yes: 1, unknown: 0.15, no: 0 },
  aiRulesGap: { incomplete: 1, unknown: 0.5, complete: 0.3 },
  reviewable: { none: 1, record: 1, unknown: 0.7, financial: 0.6, irreversible: 0.4 },
  judgment: { yes: 1, unknown: 0.35, no: 0 },
  physical: { yes: 1, unknown: 0.2, no: 0 },
  humanRulesGap: { incomplete: 1, unknown: 0.4, complete: 0 },
  inputNotReady: { paper: 0.6, unstructured: 0.5, unknown: 0.4, semi_structured: 0.3, structured: 0 },
} as const;

/** Points taken off AI approaches for their cost, risk and governance, so they must earn their place. */
export const COMPLEXITY_PENALTY = { ai_assist: 15, agent: 30 } as const;

/** Upper limits when a fact rules an approach out or holds it back. */
export const CAPS = {
  judgment: { rpa: 15, api: 15, ai_assist: 30, agent: 20 },
  physical: 10,
  inputMustBeRead: 35,
  rulesIncomplete: 45,
  screensUnstable: 40,
  /** Where a confirmed API covers the work, automating the screens is the more fragile route. */
  rpaWhenApiConfirmed: 75,
  apiAbsent: 0,
  apiNoSystem: 10,
  apiNotConfirmed: 60,
  nothingForAi: 20,
  agentConditionFails: 10,
  agentConditionUnknown: 25,
} as const;
/** A step that needs judgment or a physical action scores at least this for staying with a person. */
export const HUMAN_FLOOR = 80;

export type HumanPoint = 'none' | 'review' | 'approve' | 'decide' | 'does_it';
export type Confidence = 'high' | 'medium' | 'low';
export type FitBand = 'strong' | 'possible' | 'weak';

export interface FactorScore {
  id: string;
  label: string;
  weight: number;
  /** 0 to 1. */
  value: number;
  points: number;
  known: boolean;
  /** What is known, in words: "The rules are written down in full". */
  text: string;
  status?: Fact<unknown>['status'];
  sources: SourceRef[];
}

export interface ApproachScore {
  approach: Approach;
  score: number;
  /** The weighted sum before caps, floor and penalty. */
  raw: number;
  factors: FactorScore[];
  caps: { to: number; reason: string }[];
  penalty: number;
  floor?: { to: number; reason: string };
  fit: FitBand;
}

export interface Unknown { key: string; question: string; general: string }
export interface StepQuestion { target: { kind: 'step' | 'system'; id: string; field: string }; question: string; whyItMatters: string }

export interface StepScore {
  stepId: string;
  /** Steps a system already does on its own are not scored. */
  alreadyAutomated: boolean;
  /** Ranked: the recommendation first. Empty when already automated. */
  scores: ApproachScore[];
  winner: Approach;
  /** The best automation approach, whether or not it wins. */
  bestAutomation: Approach;
  /** Kept with a person only because no approach reaches the "possible" band on what is known. */
  forNow: boolean;
  aiNeeded: boolean;
  /** Automated without AI: said outright. */
  aiUnnecessary: boolean;
  human: HumanPoint;
  rework: boolean;
  reason: string;
  /** Share of the winner's factor weight that rests on known facts, 0 to 1. */
  knownShare: number;
  confidence: Confidence;
  unknowns: Unknown[];
  questions: StepQuestion[];
  /** Would API integration win if the systems' APIs were confirmed for this work? */
  apiWouldWin: boolean;
}

// ---------------------------------------------------------------- reading the facts

interface Read<S extends string> { state: S; fact: Fact<unknown> | null; key: string; question: string; general: string }
type YesNo = 'yes' | 'no' | 'unknown';

const TEXT = {
  rules: { complete: 'The rules are written down in full', incomplete: 'The rules are incomplete or unstable', unknown: 'It is not known whether the rules are written down in full' },
  input: { structured: 'The input is structured data', semi_structured: 'The input is semi-structured (emails, varying forms)', unstructured: 'The input is unstructured documents', paper: 'The input is on paper', unknown: 'The form of the input is not known' },
  judgment: { yes: 'Needs a judgment or an accountable decision', no: 'No judgment is needed', unknown: 'It is not known whether a judgment is needed' },
  physical: { yes: 'Needs a physical action', no: 'No physical action is needed', unknown: 'It is not known whether a physical action is needed' },
  language: { yes: 'Drafts, summarises or classifies free text', no: 'Does not work with free text', unknown: 'It is not known whether it works with free text' },
  write: { none: 'Changes nothing', record: 'Updates a record', financial: 'Makes a financial change', irreversible: 'Makes a change that cannot be undone', unknown: 'It is not known what the step changes' },
  agent: {
    ambiguity: 'The next action cannot be written down as rules', adaptive: 'The next step depends on what was found', toolChoice: 'Needs a choice of tools or lines of enquiry',
    value: 'An agent adds value over rules and a person', controllable: 'Its actions can be bounded, logged and reversed',
  },
} as const;

const known = (f: Fact<unknown> | undefined): Fact<unknown> | null => (f && f.status !== 'unknown' && f.value !== null && f.value !== undefined ? f : null);
const yesNo = (f: Fact<unknown> | null): YesNo => (f ? (f.value === true ? 'yes' : 'no') : 'unknown');

const NON_INTEGRABLE: SystemRef['kind'][] = ['scanner'];
const apiOf = (s: SystemRef): AccessMethod[] => s.access.filter(a => a.method === 'api');
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 3));

/** Words too common in this process to show that an operation is about a particular step ("invoice"). */
function commonWords(model: ProcessModel): Set<string> {
  const counts = new Map<string, number>();
  for (const st of model.steps) for (const w of words(st.name)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const limit = Math.max(3, Math.ceil(model.steps.length * 0.25));
  return new Set([...words(model.meta.name), ...[...counts].filter(([, n]) => n >= limit).map(([w]) => w)]);
}

/** Whether an interface's stated operations mention the work of the step, ignoring words common to the process. */
function covers(a: AccessMethod, step: Step, common: Set<string>): boolean {
  const stepWords = [...words(`${step.name} ${step.description}`)].filter(w => !common.has(w));
  const stem = (w: string) => w.slice(0, 5);
  return a.operations.some(op => [...words(op)].filter(w => !common.has(w)).some(w => stepWords.some(s => s === w || (w.length >= 5 && s.length >= 5 && stem(s) === stem(w)))));
}

type ApiState = keyof typeof VALUES.interfacePerSystem;
interface SystemApi { system: SystemRef; state: ApiState; method?: AccessMethod }

interface StepFacts {
  rules: Read<'complete' | 'incomplete' | 'unknown'>;
  input: Read<InputForm | 'unknown'>;
  judgment: Read<YesNo>;
  physical: Read<YesNo>;
  language: Read<YesNo>;
  write: Read<WriteImpact | 'unknown'>;
  agent: Record<keyof typeof TEXT.agent, Read<YesNo>>;
  systems: SystemRef[];
  apis: SystemApi[];
  screens: 'stable' | 'unstable' | 'unknown' | 'none';
}

const TRAIT_GENERAL: Record<string, string> = {
  rulesComplete: 'Are the rules written down in full and stable?', input: 'What form is the input: structured data, documents or paper?',
  judgment: 'Does the step need a judgment or an accountable decision?', physical: 'Does the step need a physical action?',
  language: 'Does the step draft, summarise or classify free text?', write: 'What does the step change?',
};

function readFacts(model: ProcessModel, step: Step, common: Set<string>): StepFacts {
  const t: StepTraits = step.traits ?? {};
  const read = <S extends string>(key: string, f: Fact<unknown> | undefined, state: (k: Fact<unknown> | null) => S): Read<S> => {
    const k = known(f);
    return { state: state(k), fact: k, key, question: `${TRAIT_GENERAL[key] ?? key} ("${step.name}")`, general: TRAIT_GENERAL[key] ?? key };
  };
  const systems = step.systemIds.map(id => model.systems.find(s => s.id === id)).filter((s): s is SystemRef => Boolean(s)).filter(s => !NON_INTEGRABLE.includes(s.kind));
  const apis: SystemApi[] = systems.map(system => {
    const list = apiOf(system);
    const covered = list.find(a => a.access === 'confirmed' && covers(a, step, common));
    if (covered) return { system, state: 'covered' as const, method: covered };
    const confirmed = list.find(a => a.access === 'confirmed');
    if (confirmed) return { system, state: 'confirmed_other' as const, method: confirmed };
    const reported = list.find(a => a.access === 'reported');
    if (reported) return { system, state: 'reported' as const, method: reported };
    const absent = list.find(a => a.access === 'confirmed_absent');
    if (absent && list.every(a => a.access === 'confirmed_absent')) return { system, state: 'absent' as const, method: absent };
    return { system, state: 'unknown' as const, method: list[0] };
  });
  const ui = systems.map(s => known(s.uiStable as Fact<unknown> | undefined));
  const screens: StepFacts['screens'] = !systems.length ? 'none' : ui.some(f => f?.value === false) ? 'unstable' : ui.every(f => f?.value === true) ? 'stable' : 'unknown';
  const agentRead = (k: keyof typeof TEXT.agent): Read<YesNo> => {
    const f = known(t.agent?.[k] as Fact<unknown> | undefined);
    return { state: yesNo(f), fact: f, key: `agent.${k}`, question: `${TEXT.agent[k]}? ("${step.name}")`, general: `${TEXT.agent[k]}?` };
  };
  return {
    rules: read('rulesComplete', t.rulesComplete, k => (k ? (k.value ? 'complete' : 'incomplete') : 'unknown')),
    input: read('input', t.input, k => (k ? (k.value as InputForm) : 'unknown')),
    judgment: read('judgment', t.judgment, yesNo),
    physical: read('physical', t.physical, yesNo),
    language: read('language', t.language, yesNo),
    write: read('write', t.write, k => (k ? (k.value as WriteImpact) : 'unknown')),
    agent: { ambiguity: agentRead('ambiguity'), adaptive: agentRead('adaptive'), toolChoice: agentRead('toolChoice'), value: agentRead('value'), controllable: agentRead('controllable') },
    systems, apis, screens,
  };
}

// ---------------------------------------------------------------- factors

const names = (list: SystemRef[]) => list.map(s => s.name).join(' and ');

function factor(id: string, label: string, weight: number, value: number, text: string, r?: Read<string> | null, isKnown?: boolean): FactorScore {
  const fact = r?.fact ?? null;
  return { id, label, weight, value, points: weight * value, known: isKnown ?? Boolean(fact), text, ...(fact ? { status: fact.status } : {}), sources: fact?.sources ?? [] };
}

function interfaceFactor(f: StepFacts, weight: number, assumeConfirmed: boolean): FactorScore {
  if (!f.apis.length) return factor('interface', 'A confirmed API for this work', weight, 0, 'No system to integrate with', null, true);
  if (assumeConfirmed) return factor('interface', 'A confirmed API for this work', weight, 1, 'Assuming the API is confirmed', null, true);
  const value = f.apis.reduce((t, a) => t + VALUES.interfacePerSystem[a.state], 0) / f.apis.length;
  const by = (s: ApiState) => f.apis.filter(a => a.state === s).map(a => a.system);
  const parts: string[] = [];
  if (by('covered').length) parts.push(`${names(by('covered'))} has a confirmed API covering this work`);
  if (by('confirmed_other').length) parts.push(`${names(by('confirmed_other'))} has a confirmed API, but it is not known to cover this work`);
  if (by('reported').length) parts.push(`an API is reported for ${names(by('reported'))} but not confirmed`);
  if (by('unknown').length) parts.push(`no API is confirmed for ${names(by('unknown'))}`);
  if (by('absent').length) parts.push(`${names(by('absent'))} is confirmed to have no API`);
  const text = parts.join('; ').replace(/^./, c => c.toUpperCase());
  const sources = f.apis.flatMap(a => a.method?.sources ?? []);
  return { id: 'interface', label: 'A confirmed API for this work', weight, value, points: weight * value, known: f.apis.every(a => a.state === 'covered' || a.state === 'absent'), text, sources };
}

function screensFactor(f: StepFacts, weight: number): FactorScore {
  const n = names(f.systems);
  const text = { none: 'No system is used in this step', stable: `The screens of ${n} are stable`, unstable: `The screens of ${n} are not stable`, unknown: `Done in the screens of ${n}; their stability is not confirmed` }[f.screens];
  return factor('screens', 'Work done on stable screens', weight, VALUES.screens[f.screens], text, null, f.screens !== 'unknown');
}

const round = (n: number) => Math.round(n);
const band = (score: number): FitBand => (score >= FIT.strong ? 'strong' : score >= FIT.possible ? 'possible' : 'weak');

function finishScore(approach: Approach, factors: FactorScore[], caps: ApproachScore['caps'], penalty = 0, floor?: ApproachScore['floor']): ApproachScore {
  const raw = factors.reduce((t, x) => t + x.points, 0);
  let score = raw - penalty;
  for (const c of caps) score = Math.min(score, c.to);
  if (floor) score = Math.max(score, floor.to);
  score = Math.max(0, Math.min(100, round(score)));
  return { approach, score, raw: round(raw), factors, caps, penalty, ...(floor ? { floor } : {}), fit: band(score) };
}

function scoreApproaches(f: StepFacts, assumeApi: boolean): Record<Approach, ApproachScore> {
  const rulesF = (w: number) => factor('rules', 'Clear, complete rules', w, VALUES.rules[f.rules.state], TEXT.rules[f.rules.state], f.rules);
  const inputF = (w: number) => factor('input', 'Structured input', w, VALUES.input[f.input.state], TEXT.input[f.input.state], f.input);
  const noJudgmentF = (w: number) => factor('noJudgment', 'No judgment needed', w, VALUES.noJudgment[f.judgment.state], TEXT.judgment[f.judgment.state], f.judgment);
  const mustRead = f.input.state === 'paper' || f.input.state === 'unstructured';

  const commonCaps = (a: 'rpa' | 'api'): ApproachScore['caps'] => [
    ...(f.judgment.state === 'yes' ? [{ to: CAPS.judgment[a], reason: 'The step needs a person\'s judgment.' }] : []),
    ...(f.physical.state === 'yes' ? [{ to: CAPS.physical, reason: 'The step needs a physical action.' }] : []),
    ...(mustRead ? [{ to: CAPS.inputMustBeRead, reason: `The input is ${f.input.state === 'paper' ? 'on paper' : 'unstructured'}; its fields have to be read before rules can run.` }] : []),
    ...(f.rules.state === 'incomplete' ? [{ to: CAPS.rulesIncomplete, reason: 'The rules have to be written down in full first.' }] : []),
  ];

  const rpa = finishScore('rpa', [rulesF(WEIGHTS.rpa.rules), inputF(WEIGHTS.rpa.input), screensFactor(f, WEIGHTS.rpa.screens), noJudgmentF(WEIGHTS.rpa.noJudgment)], [
    ...commonCaps('rpa'),
    ...(f.screens === 'unstable' ? [{ to: CAPS.screensUnstable, reason: 'The screens are not stable enough to automate.' }] : []),
    ...(f.apis.length && (assumeApi || f.apis.every(a => a.state === 'covered')) ? [{ to: CAPS.rpaWhenApiConfirmed, reason: 'A confirmed API covers this work, so automating the screens would be the more fragile route.' }] : []),
  ]);

  const iface = interfaceFactor(f, WEIGHTS.api.interface, assumeApi);
  const apiCaps = [...commonCaps('api')];
  if (!f.apis.length) apiCaps.push({ to: CAPS.apiNoSystem, reason: 'The step uses no system to integrate with.' });
  else if (!assumeApi && f.apis.every(a => a.state === 'absent')) apiCaps.push({ to: CAPS.apiAbsent, reason: `${names(f.systems)} is confirmed to have no API.` });
  else if (!assumeApi && !f.apis.every(a => a.state === 'covered')) apiCaps.push({ to: CAPS.apiNotConfirmed, reason: 'No API is confirmed for this work, so integration cannot be planned on yet.' });
  const api = finishScore('api', [iface, rulesF(WEIGHTS.api.rules), inputF(WEIGHTS.api.input), noJudgmentF(WEIGHTS.api.noJudgment)], apiCaps);

  const reading = Math.max(VALUES.readingByInput[f.input.state], VALUES.readingByLanguage[f.language.state]);
  const readingText = mustRead ? TEXT.input[f.input.state] : f.language.state === 'yes' ? TEXT.language.yes : f.input.state === 'semi_structured' ? TEXT.input.semi_structured
    : reading === 0 ? 'Structured data and no free text: nothing here needs AI' : 'It is not known whether documents or free text are involved';
  const readingKnown = reading === 1 || (Boolean(f.input.fact) && Boolean(f.language.fact));
  const readingFactor: FactorScore = { ...factor('needsReading', 'Documents or free text to read', WEIGHTS.ai_assist.needsReading, reading, readingText, mustRead || f.input.state === 'semi_structured' ? f.input : f.language.fact ? f.language : f.input, readingKnown) };
  const ai = finishScore('ai_assist', [
    readingFactor,
    factor('rulesGap', 'No complete rules to follow', WEIGHTS.ai_assist.rulesGap, VALUES.aiRulesGap[f.rules.state], TEXT.rules[f.rules.state], f.rules),
    noJudgmentF(WEIGHTS.ai_assist.noJudgment),
    factor('reviewable', 'Output a person can review', WEIGHTS.ai_assist.reviewable, VALUES.reviewable[f.write.state], TEXT.write[f.write.state], f.write),
  ], [
    ...(f.judgment.state === 'yes' ? [{ to: CAPS.judgment.ai_assist, reason: 'AI can prepare the case, but a person makes the judgment.' }] : []),
    ...(f.physical.state === 'yes' ? [{ to: CAPS.physical, reason: 'The step needs a physical action.' }] : []),
    ...(reading === 0 ? [{ to: CAPS.nothingForAi, reason: 'The input is structured data and there is no free text: rules can do this without AI.' }] : []),
  ], COMPLEXITY_PENALTY.ai_assist);

  const agentKeys = Object.keys(TEXT.agent) as (keyof typeof TEXT.agent)[];
  const agentStates = agentKeys.map(k => f.agent[k].state);
  const agent = finishScore('agent', agentKeys.map(k => factor(k, TEXT.agent[k], WEIGHTS.agent[k], f.agent[k].state === 'yes' ? 1 : 0, f.agent[k].state === 'unknown' ? `It is not shown that ${lower(TEXT.agent[k])}` : `${TEXT.agent[k]}: ${f.agent[k].state}`, f.agent[k])), [
    ...(agentStates.includes('no') ? [{ to: CAPS.agentConditionFails, reason: 'An agent is only justified when all five conditions hold, and at least one does not.' }] : []),
    ...(agentStates.includes('unknown') ? [{ to: CAPS.agentConditionUnknown, reason: 'An agent is only justified when all five conditions are shown to hold.' }] : []),
    ...(f.judgment.state === 'yes' ? [{ to: CAPS.judgment.agent, reason: 'The step needs a person\'s judgment.' }] : []),
    ...(f.physical.state === 'yes' ? [{ to: CAPS.physical, reason: 'The step needs a physical action.' }] : []),
  ], COMPLEXITY_PENALTY.agent);

  const mustStay = f.judgment.state === 'yes' || f.physical.state === 'yes';
  const human = finishScore('human', [
    factor('judgment', 'Judgment or accountable decision', WEIGHTS.human.judgment, VALUES.judgment[f.judgment.state], TEXT.judgment[f.judgment.state], f.judgment),
    factor('physical', 'Physical action', WEIGHTS.human.physical, VALUES.physical[f.physical.state], TEXT.physical[f.physical.state], f.physical),
    factor('rulesGap', 'No complete rules to follow', WEIGHTS.human.rulesGap, VALUES.humanRulesGap[f.rules.state], TEXT.rules[f.rules.state], f.rules),
    factor('inputNotReady', 'Input not ready for a machine', WEIGHTS.human.inputNotReady, VALUES.inputNotReady[f.input.state], TEXT.input[f.input.state], f.input),
  ], [], 0, mustStay ? { to: HUMAN_FLOOR, reason: f.judgment.state === 'yes' ? 'A judgment or accountable decision stays with a person.' : 'A physical action stays with a person.' } : undefined);

  return { rpa, api, ai_assist: ai, agent, human };
}

// ---------------------------------------------------------------- one step

const bestOf = (s: Record<Approach, ApproachScore>): ApproachScore => AUTOMATION.map(a => s[a]).reduce((best, x) => (x.score > best.score ? x : best));

/** What most holds an approach back: its lowest binding cap, else the factor that loses the most points. */
export function limiter(a: ApproachScore): string {
  const binding = a.caps.filter(c => c.to < a.raw - a.penalty);
  if (binding.length) return [...binding].sort((x, y) => x.to - y.to)[0].reason;
  const worst = [...a.factors].sort((x, y) => (y.weight - y.points) - (x.weight - x.points))[0];
  return worst && worst.weight - worst.points > 0 ? `${worst.text}.` : '';
}

/** Lower-cases a sentence start, leaving names and acronyms ("SAP", "RPA") alone. */
export const lower = (s: string) => (/^[A-Z][a-z' ]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const joinAnd = (list: string[]) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

function reasonFor(winner: ApproachScore, runnerUp: ApproachScore | undefined, best: ApproachScore, forNow: boolean): string {
  if (winner.approach === 'human') {
    if (!forNow) return `${winner.floor?.reason ?? 'This step stays with a person.'}`;
    return `No automation approach reaches ${FIT.possible} on what is known; the closest is ${APPROACH_LABEL[best.approach]} at ${best.score}. ${limiter(best)}`.trim();
  }
  const strengths = winner.factors.filter(x => x.known && x.value >= 0.7).map(x => lower(x.text));
  const first = strengths.length ? `${joinAnd(strengths).replace(/^./, c => c.toUpperCase())}.` : 'Scored on what is known so far; most facts are still open.';
  const second = runnerUp && runnerUp.approach !== 'human' ? ` ${APPROACH_LABEL[runnerUp.approach]} scores ${runnerUp.score}: ${lower(limiter(runnerUp))}` : '';
  return `${first}${second}`.trim();
}

export function scoreStep(model: ProcessModel, step: Step, common = commonWords(model)): StepScore {
  const rework = known(step.traits?.rework as Fact<unknown> | undefined)?.value === true;
  if (step.taskType === 'service') {
    return {
      stepId: step.id, alreadyAutomated: true, scores: [], winner: 'human', bestAutomation: 'rpa', forNow: false, aiNeeded: false, aiUnnecessary: false, human: 'none', rework,
      reason: 'A system already does this step on its own; there is nothing to automate.', knownShare: 1, confidence: 'high', unknowns: [], questions: [], apiWouldWin: false,
    };
  }
  const f = readFacts(model, step, common);
  const s = scoreApproaches(f, false);
  const best = bestOf(s);
  const automated = best.score >= FIT.possible && best.score >= s.human.score;
  const winner = automated ? best : s.human;
  const forNow = !automated && !s.human.floor;
  const order = (Object.keys(s) as Approach[]).map(a => s[a]).filter(x => x !== winner)
    .sort((x, y) => y.score - x.score || [...AUTOMATION, 'human'].indexOf(x.approach) - [...AUTOMATION, 'human'].indexOf(y.approach));
  const scores = [winner, ...order];

  const write = f.write.state;
  let human: HumanPoint = winner.approach === 'human' ? (f.judgment.state === 'yes' ? 'decide' : 'does_it') : winner.approach === 'ai_assist' ? 'review' : winner.approach === 'agent' ? 'approve' : 'none';
  if (winner.approach !== 'human' && (write === 'financial' || write === 'irreversible')) human = 'approve';

  const weightOf = (list: FactorScore[]) => list.reduce((t, x) => t + x.weight, 0);
  const knownShare = weightOf(winner.factors.filter(x => x.known)) / weightOf(winner.factors);

  // Unknown facts behind the winner and the best automation approach: answering them could change the ranking.
  const unknowns: Unknown[] = [];
  const push = (u: Unknown) => { if (!unknowns.some(x => x.key === u.key)) unknowns.push(u); };
  for (const r of [f.rules, f.input, f.judgment, f.physical, ...(s.ai_assist.score >= 20 || winner.approach === 'human' ? [f.language] : [])]) {
    if (!r.fact) push({ key: `trait:${r.key}`, question: r.question, general: r.general });
  }
  for (const sys of f.systems) {
    if (!known(sys.uiStable as Fact<unknown> | undefined)) push({ key: `screens:${sys.id}`, question: `Are the screens of ${sys.name} stable enough to automate?`, general: `Are the screens of ${sys.name} stable enough to automate?` });
  }
  const openApis = f.apis.filter(a => a.state !== 'covered' && a.state !== 'absent');
  for (const a of openApis) push({ key: `api:${a.system.id}`, question: `Does ${a.system.name} have an API that covers "${step.name}"?`, general: `Does ${a.system.name} have an API for this work?` });

  const whatIf = openApis.length ? scoreApproaches(f, true) : null;
  const apiWouldWin = Boolean(whatIf && winner.approach !== 'api' && !s.human.floor && bestOf(whatIf).approach === 'api' && whatIf.api.score >= FIT.possible);
  const questions: StepQuestion[] = winner.approach === 'human' && !forNow ? [] : openApis.map(a => ({
    target: { kind: 'system' as const, id: a.system.id, field: 'access' }, question: `Confirm whether ${a.system.name} has an API that covers "${step.name}".`,
    whyItMatters: 'A confirmed API would make integration the better route than automating the screens.',
  }));

  return {
    stepId: step.id, alreadyAutomated: false, scores, winner: winner.approach, bestAutomation: best.approach, forNow,
    aiNeeded: winner.approach === 'ai_assist' || winner.approach === 'agent', aiUnnecessary: winner.approach === 'rpa' || winner.approach === 'api',
    human, rework, reason: reasonFor(winner, order[0], best, forNow), knownShare,
    confidence: knownShare >= 0.8 ? 'high' : knownShare >= 0.5 ? 'medium' : 'low', unknowns, questions, apiWouldWin,
  };
}

export function scoreSteps(model: ProcessModel): StepScore[] {
  const common = commonWords(model);
  return model.steps.map(s => scoreStep(model, s, common));
}

export const scoreOf = (s: StepScore, a: Approach): number => s.scores.find(x => x.approach === a)?.score ?? 0;
