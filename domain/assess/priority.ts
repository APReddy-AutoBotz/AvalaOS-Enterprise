// What to do with the recommendation: is the process ready, how hard is the build, what is it
// worth, and so where does it sit among other candidates. Like the step scores, every number here
// comes from fixed, published tables; nothing is typed in and nothing is decided by AI.
//
// The shape follows how automation programmes assess candidates (stability first, then ease of
// implementation, then benefit, then a value-against-effort placement), extended to cover AI and
// agents, and with the 80/20 rule applied twice: to the cases (standard path first) and to the
// steps (the few that carry most of the effort first).
import type { ChangeLevel, Fact, InputForm, Metric, ProcessModel } from '../processModel/types.ts';
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
export interface EaseFactor { id: keyof typeof EASE_WEIGHTS; label: string; weight: number; value: number; points: number; known: boolean; text: string }
export interface EaseMultiplier { id: keyof typeof EASE_MULTIPLIERS; factor: number; text: string }
export interface Ease { score: number; band: EaseBand; factors: EaseFactor[]; multipliers: EaseMultiplier[]; knownShare: number }

export type ReadinessState = 'ready' | 'fix_first' | 'wait';
export interface Readiness { state: ReadinessState; label: string; reasons: string[]; open: string[] }

export type Quadrant = 'quick_win' | 'major_project' | 'fill_in' | 'not_now';
export const QUADRANT: Record<Quadrant, { label: string; text: string }> = {
  quick_win: { label: 'Quick win', text: 'High value and easier to build. Do it first.' },
  major_project: { label: 'Major project', text: 'High value but harder to build. Plan it as a project with a business case.' },
  fill_in: { label: 'Fill-in', text: 'Lower value and easier to build. Do it when a team has capacity.' },
  not_now: { label: 'Not now', text: 'Lower value and harder to build. Leave it unless the volume or the systems change.' },
};

export interface InputGroup { id: string; label: string; known: number; total: number }

export interface Priority {
  readiness: Readiness;
  /** Null when no step is recommended for automation. */
  ease: Ease | null;
  value: Computed<{ hours: Range; mid: number; fte: number; high: boolean }>;
  // Both variants name every field, so narrowing on `placed` works without strictNullChecks.
  placement: { placed: true; quadrant: Quadrant; reason?: undefined } | { placed: false; reason: string; quadrant?: undefined };
  /** Cases: the share that follows the standard path, when the exception rate is known. */
  standardPath: Computed<{ share: number; caution: boolean; text: string }>;
  /** Steps: the fewest steps that carry 80% of the effort automation could take. */
  focus: Computed<{ stepIds: string[]; of: number; share: number }>;
  inputs: { groups: InputGroup[]; known: number; total: number; share: number };
}

const band = (bands: Bands, n: number) => bands.find(([limit]) => n <= limit)![1];
const knownFact = <T>(f: Fact<T> | undefined): T | null => (f && f.status !== 'unknown' && f.value !== null ? f.value : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isProcessLevel = (x: Metric) => !x.appliesTo || x.appliesTo === 'process';
export const processMetric = (m: ProcessModel, kind: Metric['kind']): Metric | undefined =>
  m.meta.metrics.find(x => x.kind === kind && isProcessLevel(x) && x.status !== 'unknown' && (x.value !== null || Boolean(x.range)));

const CHANGE_TEXT: Record<ChangeLevel | 'unknown', string> = { none: 'no change is expected', minor: 'minor change is expected', major: 'major change is expected', unknown: 'nobody has said whether change is expected' };

function easeOf(model: ProcessModel, automated: StepScore[]): Ease | null {
  if (!automated.length) return null;
  const steps = automated.map(s => model.steps.find(x => x.id === s.stepId)!).filter(Boolean);
  const factor = (id: keyof typeof EASE_WEIGHTS, label: string, value: number, known: boolean, text: string): EaseFactor =>
    ({ id, label, weight: EASE_WEIGHTS[id], value, points: EASE_WEIGHTS[id] * value, known, text });

  const pc = knownFact(model.meta.profile?.processChange) ?? 'unknown';
  const sc = knownFact(model.meta.profile?.systemChange) ?? 'unknown';
  const inputs = steps.map(s => (knownFact(s.traits?.input) ?? 'unknown') as InputForm | 'unknown');
  const inputValue = inputs.reduce((t, i) => t + EASE_VALUES.input[i], 0) / inputs.length;
  const structured = inputs.filter(i => i === 'structured').length;
  const inputUnknown = inputs.filter(i => i === 'unknown').length;
  const paths = model.exceptions.length;
  const systemIds = [...new Set(steps.flatMap(s => s.systemIds))].filter(id => model.systems.some(x => x.id === id));

  const factors: EaseFactor[] = [
    factor('processStability', 'The process is stable', EASE_VALUES.change[pc], pc !== 'unknown', `For the process, ${CHANGE_TEXT[pc]} in the next six months.`),
    factor('systemStability', 'The applications are stable', EASE_VALUES.change[sc], sc !== 'unknown', `For the applications, ${CHANGE_TEXT[sc]} in the next six months.`),
    factor('input', 'The input is structured', inputValue, inputUnknown === 0,
      `${structured} of the ${plural(steps.length, 'step')} to automate ${structured === 1 ? 'works' : 'work'} on structured data${inputUnknown ? `; the input of ${inputUnknown} is not known` : ''}.`),
    factor('variability', 'Few exception paths', band(EASE_VALUES.exceptionPaths, paths), true, `The process map has ${plural(paths, 'exception path')}.`),
    factor('length', 'Few steps to build', band(EASE_VALUES.steps, steps.length), true, `${plural(steps.length, 'step')} to automate.`),
    factor('applications', 'Few applications to connect', systemIds.length ? band(EASE_VALUES.applications, systemIds.length) : EASE_VALUES.noApplications, systemIds.length > 0,
      systemIds.length ? `The steps to automate use ${plural(systemIds.length, 'application')}.` : 'No application is recorded on the steps to automate.'),
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
  const score = Math.round(multipliers.reduce((t, m) => t * m.factor, base));
  const knownWeight = factors.filter(x => x.known).reduce((t, x) => t + x.weight, 0);
  return { score, band: score >= EASE_BANDS.easy ? 'easy' : score >= EASE_BANDS.medium ? 'medium' : 'difficult', factors, multipliers, knownShare: knownWeight / 100 };
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

export function prioritise(model: ProcessModel, ctx: { scored: StepScore[]; cautions: Caution[]; hours: Computed<{ today: Range; automatable: Range }>; automationShare: (s: StepScore) => number }): Priority {
  const automated = ctx.scored.filter(s => s.winner !== 'human');
  const readiness = readinessOf(model, ctx.cautions);
  const ease = easeOf(model, automated);

  let value: Priority['value'] = { computable: false, reason: ctx.hours.reason ?? '' };
  if (ctx.hours.computable) {
    const hours = ctx.hours.value!.automatable;
    const mid = (hours[0] + hours[1]) / 2;
    value = { computable: true, value: { hours, mid, fte: mid / PRIORITY.hoursPerFte, high: mid >= PRIORITY.valueHoursPerYear } };
  }

  let placement: Priority['placement'];
  if (!ease) placement = { placed: false, reason: 'No step is recommended for automation yet.' };
  else if (!value.computable) placement = { placed: false, reason: `The value is not known yet. ${value.reason}` };
  else {
    const easier = ease.score >= PRIORITY.ease;
    placement = { placed: true, quadrant: value.value!.high ? (easier ? 'quick_win' : 'major_project') : easier ? 'fill_in' : 'not_now' };
  }

  // ---- 80/20 on the cases
  const ex = processMetric(model, 'exception_rate');
  let standardPath: Priority['standardPath'] = { computable: false, reason: 'The share of cases that leave the standard path is not known.' };
  if (ex) {
    const rate = Math.min(100, Math.max(0, ex.value ?? (ex.range![0] + ex.range![1]) / 2));
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
    return { id: s.stepId, weight: effort === null ? null : effort * ((share ?? 100) / 100) * ctx.automationShare(s) };
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

  return { readiness, ease, value, placement, standardPath, focus, inputs: { groups, known, total, share: total ? known / total : 0 } };
}
