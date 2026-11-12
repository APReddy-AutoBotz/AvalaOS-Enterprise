// What to do with the recommendation: is the process ready, how hard is the build, what is it
// worth, and so where does it sit among other candidates. Like the step scores, every number here
// comes from fixed, published tables; nothing is typed in and nothing is decided by AI.
//
// The shape follows how automation programmes assess candidates (stability first, then ease of
// implementation, then benefit, then a value-against-effort placement), extended to cover AI and
// agents, and with the 80/20 rule applied twice: to the cases (standard path first) and to the
// steps (the few that carry most of the effort first).
import type { ChangeLevel, Fact, InputForm, Metric, ProcessModel } from '../processModel/types.ts';
import { metricNumber, processMetric } from '../processModel/selectors.ts';
import type { StepScore } from './scoring.ts';
import type { Caution, Computed, Range } from './process.ts';

export const EASE_WEIGHTS = { processStability: 15, systemStability: 10, input: 20, variability: 20, length: 15, applications: 20 } as const;

/** A count mapped to a value: the first row whose limit the count does not exceed. */
type Bands = readonly (readonly [limit: number, value: number])[];
export const EASE_VALUES = {
  change: { none: 1, minor: 0.6, major: 0.1, unknown: 0.5 },
  input: { structured: 1, semi_structured: 0.6, unstructured: 0.25, paper: 0, unknown: 0.5 },
  exceptionPaths: [[2, 1], [5, 0.7], [10, 0.45], [Infinity, 0.2]] as Bands,
  steps: [[5, 1], [10, 0.8], [20, 0.5], [Infinity, 0.25]] as Bands,
  applications: [[1, 1], [2, 0.85], [4, 0.6], [Infinity, 0.35]] as Bands,
  noApplications: 0.7,
} as const;

/** Each applies to the weighted total. Remote desktop applies in proportion to the applications reached that way. */
export const EASE_MULTIPLIERS = { scannedInput: 0.9, remoteDesktop: 0.7, aiSteps: 0.85, agentSteps: 0.7 } as const;
export const EASE_BANDS = { easy: 65, medium: 35 } as const;

export const PRIORITY = {
  /** Hands-on hours a year that automation could take, at or above which the value counts as high. */
  valueHoursPerYear: 1000,
  /** Ease of implementation at or above which the build counts as easier. */
  ease: 50,
  /** Share of cases on the standard path below which exceptions get a caution, and the share of effort the first steps should cover. */
  pareto: 0.8,
  /** Hours one full-time person works in a year (215 days of 8 hours), used only to show hours as people. */
  hoursPerFte: 1720,
} as const;

export type EaseBand = 'easy' | 'medium' | 'difficult';
export interface EaseFactor { id: keyof typeof EASE_WEIGHTS; label: string; weight: number; value: number; points: number; known: boolean; text: string; /** The value at worst and at best while the fact is not known. */ bounds: Range }
export interface EaseMultiplier { id: keyof typeof EASE_MULTIPLIERS; factor: number; text: string }
export interface Ease { score: number; band: EaseBand; /** The score if every unknown fact turned out worst, and best. */ range: Range; factors: EaseFactor[]; multipliers: EaseMultiplier[]; knownShare: number }

export type ReadinessState = 'ready' | 'fix_first' | 'wait';
export interface Readiness { state: ReadinessState; label: string; reasons: string[]; open: string[] }

export type Quadrant = 'quick_win' | 'major_project' | 'fill_in' | 'not_now';
export const QUADRANT: Record<Quadrant, { label: string; text: string }> = {
  quick_win: { label: 'Quick win', text: 'High value and easier to build. Do it first.' },
  major_project: { label: 'Major project', text: 'High value but harder to build. Plan it as a project with a business case.' },
  fill_in: { label: 'Fill-in', text: 'Lower value and easier to build. Do it when a team has capacity.' },
  not_now: { label: 'Not now', text: 'Lower value and harder to build. Leave it unless the volume or the systems change.' },
};

export type ValueBasis = 'step_times' | 'time_per_case' | 'people';
export interface ValueEstimate {
  /** Hands-on hours a year automation could take: at least, and at most. */
  hours: Range;
  /** True when both ends are calculated from step times and shares; false when only an upper bound is known. */
  exact: boolean;
  basis: ValueBasis;
  mid: number;
  fte: number;
  /** Whether the value is at or above the line: 'either' when the bounds lie on both sides of it. */
  high: 'yes' | 'no' | 'either';
  /** Steps whose time is a recorded assumption, not a stated or confirmed fact. */
  assumedSteps: number;
}
export interface Placement {
  /** True when only one quadrant is possible on what is known. */
  placed: boolean;
  quadrant?: Quadrant;
  /** Every quadrant still possible; empty when no step is recommended for automation. */
  possible: Quadrant[];
  /** When not placed: what would decide it. */
  reason: string;
}
export interface NextInput { id: string; label: string; why: string }

export interface InputGroup { id: string; label: string; known: number; total: number }

export interface Priority {
  readiness: Readiness;
  /** Null when no step is recommended for automation. */
  ease: Ease | null;
  value: Computed<ValueEstimate>;
  placement: Placement;
  /** The inputs that would sharpen the result most, most useful first. */
  nextInputs: NextInput[];
  /** Cases: the share that follows the standard path, when the exception rate is known. */
  standardPath: Computed<{ share: number; caution: boolean; text: string }>;
  /** Steps: the fewest steps that carry 80% of the effort automation could take. */
  focus: Computed<{ stepIds: string[]; of: number; share: number }>;
  inputs: { groups: InputGroup[]; known: number; total: number; share: number };
}

const band = (bands: Bands, n: number) => bands.find(([limit]) => n <= limit)![1];
const knownFact = <T>(f: Fact<T> | undefined): T | null => (f && f.status !== 'unknown' && f.value !== null ? f.value : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pcUnknown = (m: ProcessModel) => knownFact(m.meta.profile?.processChange) === null || knownFact(m.meta.profile?.systemChange) === null;
const CHANGE_TEXT: Record<ChangeLevel | 'unknown', string> = { none: 'no change is expected', minor: 'minor change is expected', major: 'major change is expected', unknown: 'nobody has said whether change is expected' };

function easeOf(model: ProcessModel, automated: StepScore[]): Ease | null {
  if (!automated.length) return null;
  const steps = automated.map(s => model.steps.find(x => x.id === s.stepId)!).filter(Boolean);
  const factor = (id: keyof typeof EASE_WEIGHTS, label: string, value: number, known: boolean, text: string, bounds: Range = [value, value]): EaseFactor =>
    ({ id, label, weight: EASE_WEIGHTS[id], value, points: EASE_WEIGHTS[id] * value, known, text, bounds: known ? [value, value] : bounds });
  const changeBounds: Range = [EASE_VALUES.change.major, EASE_VALUES.change.none];

  const pc = knownFact(model.meta.profile?.processChange) ?? 'unknown';
  const sc = knownFact(model.meta.profile?.systemChange) ?? 'unknown';
  const inputs = steps.map(s => (knownFact(s.traits?.input) ?? 'unknown') as InputForm | 'unknown');
  const inputValue = inputs.reduce((t, i) => t + EASE_VALUES.input[i], 0) / inputs.length;
  const structured = inputs.filter(i => i === 'structured').length;
  const inputUnknown = inputs.filter(i => i === 'unknown').length;
  const paths = model.exceptions.length;
  const systemIds = [...new Set(steps.flatMap(s => s.systemIds))].filter(id => model.systems.some(x => x.id === id));

  const factors: EaseFactor[] = [
    factor('processStability', 'The process is stable', EASE_VALUES.change[pc], pc !== 'unknown', `For the process, ${CHANGE_TEXT[pc]} in the next six months.`, changeBounds),
    factor('systemStability', 'The applications are stable', EASE_VALUES.change[sc], sc !== 'unknown', `For the applications, ${CHANGE_TEXT[sc]} in the next six months.`, changeBounds),
    factor('input', 'The input is structured', inputValue, inputUnknown === 0,
      `${structured} of the ${plural(steps.length, 'step')} to automate ${structured === 1 ? 'works' : 'work'} on structured data${inputUnknown ? `; the input of ${inputUnknown} is not known` : ''}.`,
      [inputValue - inputUnknown * EASE_VALUES.input.unknown / inputs.length, inputValue + inputUnknown * (1 - EASE_VALUES.input.unknown) / inputs.length]),
    factor('variability', 'Few exception paths', band(EASE_VALUES.exceptionPaths, paths), true, `The process map has ${plural(paths, 'exception path')}.`),
    factor('length', 'Few steps to build', band(EASE_VALUES.steps, steps.length), true, `${plural(steps.length, 'step')} to automate.`),
    factor('applications', 'Few applications to connect', systemIds.length ? band(EASE_VALUES.applications, systemIds.length) : EASE_VALUES.noApplications, systemIds.length > 0,
      systemIds.length ? `The steps to automate use ${plural(systemIds.length, 'application')}.` : 'No application is recorded on the steps to automate.', [EASE_VALUES.applications[EASE_VALUES.applications.length - 1][1], 1]),
  ];

  const multipliers: EaseMultiplier[] = [];
  const scanned = inputs.filter(i => i === 'paper').length;
  if (scanned) multipliers.push({ id: 'scannedInput', factor: EASE_MULTIPLIERS.scannedInput, text: `${plural(scanned, 'step')} ${scanned === 1 ? 'starts' : 'start'} from paper or scans, which have to be read first.` });
  const remote = systemIds.filter(id => knownFact(model.systems.find(x => x.id === id)!.remote) === true).length;
  if (remote) multipliers.push({ id: 'remoteDesktop', factor: 1 - (1 - EASE_MULTIPLIERS.remoteDesktop) * (remote / systemIds.length), text: `${plural(remote, 'application')} of ${systemIds.length} ${remote === 1 ? 'is' : 'are'} reached through a remote desktop, where a robot sees only an image of the screen.` });
  const agent = automated.filter(s => s.winner === 'agent').length;
  const ai = automated.filter(s => s.winner === 'ai_assist').length;
  if (agent) multipliers.push({ id: 'agentSteps', factor: EASE_MULTIPLIERS.agentSteps, text: `${plural(agent, 'step')} ${agent === 1 ? 'needs' : 'need'} an agent, which has to be bounded, evaluated and monitored.` });
  else if (ai) multipliers.push({ id: 'aiSteps', factor: EASE_MULTIPLIERS.aiSteps, text: `${plural(ai, 'step')} ${ai === 1 ? 'needs' : 'need'} AI, which has to be evaluated and reviewed by a person.` });

  const base = factors.reduce((t, x) => t + x.points, 0);
  const applied = multipliers.reduce((t, m) => t * m.factor, 1);
  const score = Math.round(base * applied);
  // At worst, every application whose access is not known is also reached through a remote desktop.
  const remoteUnknown = systemIds.filter(id => knownFact(model.systems.find(x => x.id === id)!.remote) === null).length;
  const worstRemote = systemIds.length ? (1 - (1 - EASE_MULTIPLIERS.remoteDesktop) * ((remote + remoteUnknown) / systemIds.length)) / (remote ? 1 - (1 - EASE_MULTIPLIERS.remoteDesktop) * (remote / systemIds.length) : 1) : 1;
  const bound = (i: 0 | 1) => Math.round(factors.reduce((t, x) => t + x.weight * x.bounds[i], 0) * applied * (i === 0 ? worstRemote : 1));
  const knownWeight = factors.filter(x => x.known).reduce((t, x) => t + x.weight, 0);
  return { score, band: score >= EASE_BANDS.easy ? 'easy' : score >= EASE_BANDS.medium ? 'medium' : 'difficult', range: [bound(0), bound(1)], factors, multipliers, knownShare: knownWeight / 100 };
}

function readinessOf(model: ProcessModel, cautions: Caution[]): Readiness {
  const pc = knownFact(model.meta.profile?.processChange);
  const sc = knownFact(model.meta.profile?.systemChange);
  const open = [
    ...(pc === null ? ['Whether the process will change in the next six months.'] : []),
    ...(sc === null ? ['Whether the applications will change in the next six months.'] : []),
  ];
  const wait = [
    ...(pc === 'major' ? ['A major change to the process is expected in the next six months. Automate the new process, not the old one.'] : []),
    ...(sc === 'major' ? ['A major change to the applications is expected in the next six months. Build after it lands, or the work is done twice.'] : []),
  ];
  if (wait.length) return { state: 'wait', label: 'Wait', reasons: wait, open };
  const fix = cautions.filter(c => c.fired && (c.id === 'redesign_first' || c.id === 'hold_for_instability')).map(c => `${c.label}. ${c.reason}`);
  if (fix.length) return { state: 'fix_first', label: 'Fix first', reasons: fix, open };
  return { state: 'ready', label: 'Ready to automate', reasons: [open.length ? 'Nothing known stands in the way.' : 'No major change is expected, and the rules are stable enough to build on.'], open };
}

const minutesOf = (m: Metric): Range => {
  const k = /hour/i.test(m.unit) ? 60 : /sec/i.test(m.unit) ? 1 / 60 : 1;
  const [lo, hi] = m.range ?? [m.value!, m.value!];
  return [lo * k, hi * k];
};

/**
 * The hours automation could take, from the best inputs there are. With time and share on every
 * step both ends are calculated. With less, only what is certain is stated: an upper bound from the
 * step times, else from volume and time per case, else from the people doing the work. Nothing is
 * spread, averaged or guessed.
 */
function valueOf(model: ProcessModel, ctx: PriorityContext): Priority['value'] {
  const rows = ctx.scored.map(s => {
    const t = model.steps.find(x => x.id === s.stepId)?.traits;
    return { effort: knownFact(t?.effortMinutes), share: knownFact(t?.sharePercent), auto: ctx.automationShare(s), assumed: t?.effortMinutes?.status === 'assumed' };
  });
  if (!rows.length) return { computable: false, reason: 'There are no steps yet.' };
  const anyAuto = rows.some(r => r.auto[1] > 0);
  const vol = ctx.volume;
  let hours: Range, exact = false, basis: ValueBasis;
  if (vol.computable && rows.every(r => r.effort !== null)) {
    exact = rows.every(r => r.share !== null);
    basis = 'step_times';
    const per = (i: 0 | 1) => rows.reduce((t, r) => t + r.effort! * ((r.share ?? 100) / 100) * r.auto[i], 0) / 60;
    hours = [exact ? vol.value![0] * per(0) : 0, vol.value![1] * per(1)];
  } else {
    const perCase = processMetric(model, 'handling_time'), people = processMetric(model, 'fte');
    let today: number;
    if (vol.computable && perCase) { today = vol.value![1] * minutesOf(perCase)[1] / 60; basis = 'time_per_case'; }
    else if (people) { today = (people.range?.[1] ?? people.value!) * PRIORITY.hoursPerFte; basis = 'people'; }
    else return { computable: false, reason: vol.computable ? 'Add the time per case, the time per step, or the number of people doing the work.' : 'Add the volume with the time per case, or the number of people doing the work.' };
    hours = [0, anyAuto ? today : 0];
  }
  const mid = (hours[0] + hours[1]) / 2;
  const high = hours[0] >= PRIORITY.valueHoursPerYear ? 'yes' : hours[1] < PRIORITY.valueHoursPerYear ? 'no' : 'either';
  return { computable: true, value: { hours, exact, basis, mid, fte: (exact ? mid : hours[1]) / PRIORITY.hoursPerFte, high, assumedSteps: rows.filter(r => r.assumed).length } };
}

export interface PriorityContext {
  scored: StepScore[]; cautions: Caution[]; volume: Computed<Range>;
  /** The share of a step's time its recommended approach takes off people, at least and at most. */
  automationShare: (s: StepScore) => Range;
  apiSwitch: { systems: string[]; steps: number };
  keyQuestions: { question: string; steps: number }[];
}

export function prioritise(model: ProcessModel, ctx: PriorityContext): Priority {
  const automated = ctx.scored.filter(s => s.winner !== 'human');
  const readiness = readinessOf(model, ctx.cautions);
  const ease = easeOf(model, automated);

  const value = valueOf(model, ctx);

  // Every quadrant the bounds still allow. One left means the process is placed.
  let placement: Placement;
  if (!ease) placement = { placed: false, possible: [], reason: 'No step is recommended for automation yet.' };
  else {
    const easier = ease.range[0] >= PRIORITY.ease ? [true] : ease.range[1] < PRIORITY.ease ? [false] : [true, false];
    const high = value.computable && value.value!.high !== 'either' ? [value.value!.high === 'yes'] : [true, false];
    const possible: Quadrant[] = high.flatMap(h => easier.map(e => (h ? (e ? 'quick_win' : 'major_project') : e ? 'fill_in' : 'not_now') as Quadrant));
    const open = ease.factors.filter(f => !f.known).map(f => f.label.toLowerCase());
    const reason = [
      high.length > 1 ? (value.computable ? `The value could lie on either side of ${PRIORITY.valueHoursPerYear.toLocaleString('en')} hours a year.` : `The value is not known. ${value.reason}`) : '',
      easier.length > 1 ? `The build effort depends on facts not yet known${open.length ? `: ${open.join(', ')}` : ''}.` : '',
    ].filter(Boolean).join(' ');
    placement = { placed: possible.length === 1, possible, reason, ...(possible.length === 1 ? { quadrant: possible[0] } : {}) };
  }

  // ---- 80/20 on the cases
  const ex = processMetric(model, 'exception_rate');
  let standardPath: Priority['standardPath'] = { computable: false, reason: 'The share of cases that leave the standard path is not known.' };
  if (ex) {
    const rate = Math.min(100, Math.max(0, metricNumber(ex)!));
    const share = 1 - rate / 100;
    const caution = share < PRIORITY.pareto;
    standardPath = { computable: true, value: { share, caution, text: caution
      ? `Only ${Math.round(share * 100)}% of cases follow the standard path. With more than ${Math.round((1 - PRIORITY.pareto) * 100)}% exceptions, much of the build would go on exception handling: automate the standard path and reduce the exceptions at their source first.`
      : `${Math.round(share * 100)}% of cases follow the standard path. Automate that path first and leave the ${Math.round(rate)}% that leave it with people until it runs.` } };
  }

  // ---- 80/20 on the steps
  let focus: Priority['focus'];
  const rows = automated.map(s => {
    const t = model.steps.find(x => x.id === s.stepId)?.traits;
    const effort = knownFact(t?.effortMinutes), share = knownFact(t?.sharePercent);
    return { id: s.stepId, weight: effort === null ? null : effort * ((share ?? 100) / 100) * ctx.automationShare(s)[1] };
  });
  if (!rows.length) focus = { computable: false, reason: 'No step is recommended for automation yet.' };
  else if (rows.some(r => r.weight === null)) focus = { computable: false, reason: `Effort is missing on ${rows.filter(r => r.weight === null).length} of the ${plural(rows.length, 'step')} to automate.` };
  else {
    const sorted = [...rows].sort((a, b) => b.weight! - a.weight!);
    const total = sorted.reduce((t, r) => t + r.weight!, 0);
    if (total === 0) focus = { computable: false, reason: 'The stated effort adds up to zero.' };
    else {
      const stepIds: string[] = [];
      let sum = 0;
      for (const r of sorted) { if (sum / total >= PRIORITY.pareto) break; stepIds.push(r.id); sum += r.weight!; }
      focus = { computable: true, value: { stepIds, of: rows.length, share: sum / total } };
    }
  }

  // ---- how complete the inputs are
  const scoredSteps = ctx.scored.map(s => model.steps.find(x => x.id === s.stepId)!).filter(Boolean);
  const FACTS = ['rulesComplete', 'input', 'judgment', 'physical', 'language', 'write'] as const;
  const systems = model.systems.filter(s => scoredSteps.some(st => st.systemIds.includes(s.id)));
  const count = (list: boolean[]) => list.filter(Boolean).length;
  const groups: InputGroup[] = [
    { id: 'profile', label: 'Process profile', total: 4, known: count([Boolean(processMetric(model, 'volume')), Boolean(ex), knownFact(model.meta.profile?.processChange) !== null, knownFact(model.meta.profile?.systemChange) !== null]) },
    { id: 'applications', label: 'Applications', total: systems.length * 2, known: systems.reduce((t, s) => t + count([s.access.some(a => a.method === 'api' && a.access !== 'unknown'), knownFact(s.uiStable) !== null]), 0) },
    { id: 'facts', label: 'Step facts', total: scoredSteps.length * FACTS.length, known: scoredSteps.reduce((t, s) => t + count(FACTS.map(k => knownFact(s.traits?.[k] as Fact<unknown> | undefined) !== null)), 0) },
    { id: 'effort', label: 'Time and share per step', total: scoredSteps.length * 2, known: scoredSteps.reduce((t, s) => t + count([knownFact(s.traits?.effortMinutes) !== null, knownFact(s.traits?.sharePercent) !== null]), 0) },
  ];
  const known = groups.reduce((t, g) => t + g.known, 0), total = groups.reduce((t, g) => t + g.total, 0);

  // ---- what to fill in next, most useful first
  const stepFacts = scoredSteps.map(s => ({ effort: knownFact(s.traits?.effortMinutes) !== null, share: knownFact(s.traits?.sharePercent) !== null }));
  const hasVolume = ctx.volume.computable, hasCase = Boolean(processMetric(model, 'handling_time')), hasPeople = Boolean(processMetric(model, 'fte'));
  const allEffort = stepFacts.length > 0 && stepFacts.every(x => x.effort), allShare = stepFacts.every(x => x.share);
  const nextInputs: NextInput[] = [
    ...(!hasVolume ? [{ id: 'volume', label: 'Volume', why: 'Gives the hours a year, and with them the value.' }] : []),
    ...(!allEffort && !hasCase ? [{ id: 'time', label: hasPeople ? 'Time per case' : 'Time per case, or the people doing the work', why: 'Bounds the value even when step times are not known.' }] : []),
    ...(pcUnknown(model) ? [{ id: 'change', label: 'Change expected in the next six months', why: 'Settles readiness and a quarter of the build effort score.' }] : []),
    ...(ctx.apiSwitch.steps > 0 ? [{ id: 'api', label: `API of ${ctx.apiSwitch.systems.join(', ')}`, why: `Confirming it would move ${plural(ctx.apiSwitch.steps, 'step')} to API integration.` }] : []),
    ...(ctx.keyQuestions[0] ? [{ id: 'fact', label: ctx.keyQuestions[0].question, why: `Not known for ${plural(ctx.keyQuestions[0].steps, 'step')}.` }] : []),
    ...(!allEffort && (hasCase || hasPeople) ? [{ id: 'step_time', label: 'Time per step', why: 'Turns the upper bound on the value into a calculated range.' }] : []),
    ...(allEffort && !allShare ? [{ id: 'share', label: 'Share of cases per step', why: 'Turns the upper bound on the value into a calculated range.' }] : []),
  ].slice(0, 4);

  return { readiness, ease, value, placement, nextInputs, standardPath, focus, inputs: { groups, known, total, share: total ? known / total : 0 } };
}
