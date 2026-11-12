// The process-level result, derived from the step results and the model; never typed in.
//
// - Composition: how many steps each mechanism covers, and how many need no AI.
// - Gates, each with a named threshold written here: discovery needed, simplify first, hold for
//   instability, not worth automating.
// - Automation potential weighted by effort, or "not computable" with the reason.
// - Benefit in hours from the volume and effort in the model; money only from a rate a person
//   entered. Nothing monetary is assumed here.
import type { Metric, ProcessModel } from '../processModel/types.ts';
import type { Mechanism, StepResult } from './rules.ts';
import { evaluateSteps } from './rules.ts';

export const THRESHOLDS = {
  /** Discovery needed when more than this share of steps have a low-confidence result. */
  discoveryLowConfidenceShare: 0.4,
  /** Simplify first when this share of steps is rework or duplicate entry. */
  redesignReworkShare: 0.2,
  /** Hold when this share of rule-bearing steps have rules stated as incomplete or unstable. */
  instabilityIncompleteRulesShare: 0.5,
  /** Not worth automating below this many hands-on hours a year that automation could take. */
  minimumAutomatableHoursPerYear: 250,
} as const;

/**
 * How much of a step's hands-on effort a mechanism takes off people, as a range. Rules, APIs and
 * UI automation take all of it. Where a person still reviews AI output, the share depends on how
 * much review is needed, which nobody has measured, so the range is the whole of 0 to 1 rather
 * than an assumed figure.
 */
export const AUTOMATION_SHARE: Record<Mechanism, Range> = {
  already_automated: [0, 0], eliminate: [1, 1], keep_human: [0, 0], rules: [1, 1], api: [1, 1], api_candidate: [0, 0], rpa: [1, 1],
  extraction: [0, 1], ai_assist: [0, 1], agent: [0, 1], no_option: [0, 0],
};

export type GateId = 'discovery_needed' | 'redesign_first' | 'hold_for_instability' | 'not_worth_automating';
export interface Gate { id: GateId; label: string; fired: boolean; reason: string }

export type Range = [number, number];
// Both variants name every field, so narrowing on `computable` works without strictNullChecks.
export type Computed<T> = { computable: true; value: T; note?: string; reason?: undefined } | { computable: false; reason: string; value?: undefined; note?: undefined };

export interface Rate { amount: number; currency: string; enteredBy: string }

export interface ProcessResult {
  steps: StepResult[];
  composition: { mechanism: Mechanism; count: number }[];
  /** For example "7 of 12 steps need no AI: 5 by API, 2 by rules; 2 need extraction; 3 stay with people". */
  summary: string;
  noAiSteps: number;
  gates: Gate[];
  headline: string;
  /** Share of hands-on effort that automation could take, 0 to 1, as a range. */
  potential: Computed<Range>;
  /** Hands-on hours per year today and the share automation could take. */
  hours: Computed<{ today: Range; automatable: Range }>;
  /** Only when a person entered a rate. */
  money: Computed<{ automatable: Range; currency: string }>;
  questions: StepResult['questions'];
}

const SHORT: Record<Mechanism, string> = {
  already_automated: 'already done by a system', eliminate: 'to eliminate or simplify', keep_human: 'stay with people', rules: 'by rules',
  api: 'by API', api_candidate: 'wait on an API confirmation', rpa: 'by UI automation', extraction: 'need document extraction',
  ai_assist: 'need AI assistance', agent: 'need a bounded agent', no_option: 'stay with people for now',
};

const PER_YEAR: Record<string, number> = { day: 250, week: 52, month: 12, quarter: 4, year: 1 };

/** Yearly volume from the process-level volume metric, as a range. */
export function yearlyVolume(m: ProcessModel): Computed<Range> {
  const v = m.meta.metrics.find(x => x.kind === 'volume' && (!x.appliesTo || x.appliesTo === 'process') && x.status !== 'unknown' && (x.value !== null || x.range));
  if (!v) return { computable: false, reason: 'The process volume is not known.' };
  const per = periodOf(v);
  if (!per) return { computable: false, reason: `The period of "${v.label}" is not clear.` };
  const [lo, hi] = v.range ?? [v.value!, v.value!];
  return { computable: true, value: [lo * PER_YEAR[per], hi * PER_YEAR[per]] };
}

function periodOf(v: Metric): string | null {
  const t = `${v.unit} ${v.period ?? ''}`.toLowerCase();
  for (const p of Object.keys(PER_YEAR)) if (t.includes(`/${p}`) || t.includes(`per ${p}`) || t.includes(`a ${p}`) || t.includes(`${p}ly`) || (p === 'day' && t.includes('daily'))) return p;
  return null;
}

export function rollUp(model: ProcessModel, options: { rate?: Rate | null; results?: StepResult[] } = {}): ProcessResult {
  const steps = options.results ?? evaluateSteps(model);
  const n = steps.length;
  const count = (ms: Mechanism[]) => steps.filter(s => ms.includes(s.mechanism)).length;
  const composition = (Object.keys(SHORT) as Mechanism[]).map(mechanism => ({ mechanism, count: count([mechanism]) })).filter(c => c.count > 0);
  const noAi = steps.filter(s => s.aiNeeded === 'no' && !['keep_human', 'no_option'].includes(s.mechanism)).length;

  const noAiParts = (['api', 'rules', 'rpa', 'already_automated', 'eliminate'] as Mechanism[]).filter(x => count([x])).map(x => `${count([x])} ${SHORT[x]}`);
  const restParts = (['extraction', 'ai_assist', 'agent', 'api_candidate', 'keep_human', 'no_option'] as Mechanism[]).filter(x => count([x])).map(x => `${count([x])} ${SHORT[x]}`);
  const summary = n === 0 ? 'There are no steps to assess.'
    : `${noAi} of ${n} steps need no AI${noAiParts.length ? `: ${noAiParts.join(', ')}` : ''}${restParts.length ? `; ${restParts.join('; ')}` : ''}.`;

  // ---- gates
  const low = steps.filter(s => s.confidence === 'low').length;
  const rework = count(['eliminate']);
  const ruleSteps = model.steps.filter(s => s.traits?.rulesComplete && s.traits.rulesComplete.status !== 'unknown');
  const unstable = ruleSteps.filter(s => s.traits!.rulesComplete!.value === false).length;
  const hours = hoursOf(model, steps);
  const automatableYear = hours.computable ? hours.value!.automatable[1] : null;
  const gates: Gate[] = [
    {
      id: 'discovery_needed', label: 'Discovery needed', fired: n > 0 && low / n > THRESHOLDS.discoveryLowConfidenceShare,
      reason: `${low} of ${n} steps have a low-confidence result (threshold: more than ${Math.round(THRESHOLDS.discoveryLowConfidenceShare * 100)}%).`,
    },
    {
      id: 'redesign_first', label: 'Simplify first', fired: n > 0 && rework / n >= THRESHOLDS.redesignReworkShare,
      reason: `${rework} of ${n} steps are rework or duplicate entry (threshold: ${Math.round(THRESHOLDS.redesignReworkShare * 100)}% or more).`,
    },
    {
      id: 'hold_for_instability', label: 'Hold until the rules are stable', fired: ruleSteps.length > 0 && unstable / ruleSteps.length >= THRESHOLDS.instabilityIncompleteRulesShare,
      reason: ruleSteps.length ? `${unstable} of ${ruleSteps.length} steps with known rules have incomplete or unstable rules (threshold: ${Math.round(THRESHOLDS.instabilityIncompleteRulesShare * 100)}% or more).` : 'No step has its rules assessed yet.',
    },
    {
      id: 'not_worth_automating', label: 'Not worth automating at this volume', fired: automatableYear !== null && automatableYear < THRESHOLDS.minimumAutomatableHoursPerYear,
      reason: automatableYear === null ? `Not decided: ${hours.reason ?? ''}` : `At most ${Math.round(automatableYear)} hands-on hours a year could be automated (threshold: ${THRESHOLDS.minimumAutomatableHoursPerYear}).`,
    },
  ];

  const fired = gates.filter(g => g.fired);
  const headline = n === 0 ? 'Add the process steps to assess it.'
    : fired.length ? `${fired.map(g => g.label).join(' and ')} before automating.`
      : noAi === n ? 'Automate without AI: every step can be handled by rules, an API, UI automation or is already done by a system.'
        : count(['extraction', 'ai_assist', 'agent']) ? `Automate mostly without AI; AI is needed in ${count(['extraction', 'ai_assist', 'agent'])} step${count(['extraction', 'ai_assist', 'agent']) === 1 ? '' : 's'}.`
          : count(['api_candidate']) ? `Confirm the APIs for ${count(['api_candidate'])} step${count(['api_candidate']) === 1 ? '' : 's'}; the rest is clear.`
            : `${count(['keep_human', 'no_option'])} of ${n} steps stay with people.`;

  // ---- potential and money
  const potential = potentialOf(model, steps);
  let money: ProcessResult['money'] = { computable: false, reason: 'No cost rate has been entered.' };
  if (options.rate && hours.computable) {
    const r = options.rate.amount;
    money = { computable: true, value: { automatable: [hours.value!.automatable[0] * r, hours.value!.automatable[1] * r], currency: options.rate.currency }, note: `At ${options.rate.currency} ${r} an hour, entered by ${options.rate.enteredBy}.` };
  } else if (options.rate && !hours.computable) money = { computable: false, reason: hours.reason ?? '' };

  const questions = steps.flatMap(s => s.questions).filter((q, i, all) => all.findIndex(x => x.question === q.question) === i);
  return { steps, composition, summary, noAiSteps: noAi, gates, headline, potential, hours, money, questions };
}

function effortOf(model: ProcessModel) {
  return model.steps.map(s => {
    const e = s.traits?.effortMinutes, sh = s.traits?.sharePercent;
    return {
      step: s,
      effort: e && e.status !== 'unknown' && e.value !== null ? e.value : null,
      share: sh && sh.status !== 'unknown' && sh.value !== null ? sh.value / 100 : null,
    };
  });
}

function potentialOf(model: ProcessModel, steps: StepResult[]): Computed<Range> {
  const rows = effortOf(model);
  const missing = rows.filter(r => r.effort === null).length;
  if (!rows.length) return { computable: false, reason: 'There are no steps.' };
  if (missing) return { computable: false, reason: `Effort is missing on ${missing} of ${rows.length} steps.` };
  const weight = (r: typeof rows[number]) => r.effort! * (r.share ?? 1);
  const total = rows.reduce((t, r) => t + weight(r), 0);
  if (total === 0) return { computable: false, reason: 'The stated effort adds up to zero.' };
  const share = (r: typeof rows[number], i: 0 | 1) => AUTOMATION_SHARE[steps.find(x => x.stepId === r.step.id)!.mechanism][i];
  const auto = (i: 0 | 1) => rows.reduce((t, r) => t + weight(r) * share(r, i), 0);
  const sharesMissing = rows.filter(r => r.share === null).length;
  return { computable: true, value: [auto(0) / total, auto(1) / total], ...(sharesMissing ? { note: `Weighted as if all cases pass through the ${sharesMissing} steps whose share is not stated.` } : {}) };
}

function hoursOf(model: ProcessModel, steps: StepResult[]): Computed<{ today: Range; automatable: Range }> {
  const vol = yearlyVolume(model);
  if (!vol.computable) return { computable: false, reason: vol.reason ?? '' };
  const rows = effortOf(model);
  const noEffort = rows.filter(r => r.effort === null).length;
  if (noEffort) return { computable: false, reason: `Effort is missing on ${noEffort} of ${rows.length} steps.` };
  const noShare = rows.filter(r => r.share === null).length;
  if (noShare) return { computable: false, reason: `The share of cases is missing on ${noShare} of ${rows.length} steps.` };
  const minutesPerCase = rows.reduce((t, r) => t + r.effort! * r.share!, 0);
  const auto = (i: 0 | 1) => rows.reduce((t, r) => t + r.effort! * r.share! * AUTOMATION_SHARE[steps.find(x => x.stepId === r.step.id)!.mechanism][i], 0);
  const [lo, hi] = vol.value!;
  return { computable: true, value: { today: [lo * minutesPerCase / 60, hi * minutesPerCase / 60], automatable: [lo * auto(0) / 60, hi * auto(1) / 60] } };
}
