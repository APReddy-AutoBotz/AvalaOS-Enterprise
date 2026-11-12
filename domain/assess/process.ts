// The process-level result, derived from the step scores; never typed in and never written by AI.
//
// - A ranking of the automation approaches (1st, 2nd, 3rd, 4th) by their average fit across the
//   steps open to automation (those that do not need a person's judgment or hands), with how many steps each wins and why.
// - A verdict and a plain-words explanation of why the first approach is proposed, built from the
//   counts and facts behind the scores.
// - The facts that, once known, would firm up or change the ranking.
// - Cautions with named thresholds, hours from stated volume and effort, and money only from a
//   rate a person entered. Nothing monetary is assumed here.
import type { ProcessModel } from '../processModel/types.ts';
import { periodOf, processMetric, stepTrait } from '../processModel/selectors.ts';
export { periodOf };
import { prioritise, type Priority } from './priority.ts';
import { DEFAULT_SETTINGS, type AssessmentSettings } from './settings.ts';
import { APPROACH_LABEL, AUTOMATION, FIT, limiter, lower, scoreOf, scoreSteps, type Approach, type Confidence, type StepQuestion, type StepScore } from './scoring.ts';

export const THRESHOLDS = {
  /** Simplify first when this share of steps is rework or duplicate entry. */
  redesignReworkShare: 0.2,
  /** Hold when this share of steps with known rules have incomplete or unstable rules. */
  instabilityIncompleteRulesShare: 0.5,
  /** Not worth automating below this many hands-on hours a year that automation could take. */
  minimumAutomatableHoursPerYear: 250,
} as const;

export type Range = [number, number];
// Both variants name every field, so narrowing on `computable` works without strictNullChecks.
export type Computed<T> = { computable: true; value: T; note?: string; reason?: undefined } | { computable: false; reason: string; value?: undefined; note?: undefined };
export interface Rate { amount: number; currency: string; enteredBy: string }

/**
 * How much of a step's hands-on effort an approach takes off people, as a range. RPA and APIs take
 * all of it. Where a person still reviews AI output, the share depends on how much review is
 * needed, which nobody has measured, so the range is the whole of 0 to 1 rather than a guess.
 */
export const AUTOMATION_SHARE: Record<Approach, Range> = { rpa: [1, 1], api: [1, 1], ai_assist: [0, 1], agent: [0, 1], human: [0, 0] };

export type CautionId = 'redesign_first' | 'hold_for_instability' | 'not_worth_automating';
export interface Caution { id: CautionId; label: string; fired: boolean; reason: string }

export interface RankedApproach {
  approach: Approach;
  rank: number;
  /** Average step score, 0 to 100. */
  score: number;
  /** Steps where this approach is the recommendation. */
  stepsWon: number;
  /** Steps where it scores in the "possible" band or better. */
  stepsFit: number;
  why: string;
  /** Its most common strength on the steps it wins, and what most often holds it back elsewhere. */
  strength: Tally | null;
  heldBack: Tally | null;
  /** What would have to change for this approach to rank higher; empty for the first. */
  toWin: string;
}

/** A fact sentence and the number of steps it applies to. */
export interface Tally { text: string; steps: number }

export interface KeyQuestion { key: string; question: string; steps: number }

export interface ProcessAssessment {
  steps: StepScore[];
  /** Steps people do today (already-automated steps are not scored). */
  assessed: number;
  /** Of those, the steps that do not need a person's judgment or hands: what the ranking is averaged over. */
  candidates: number;
  alreadyAutomated: number;
  counts: Record<Approach, number>;
  ranking: RankedApproach[];
  /** The first-ranked approach, or null when no step is recommended for automation. */
  lead: Approach | null;
  /** Short title: "RPA-led automation". */
  verdict: string;
  /** One sentence with the split of steps. */
  split: string;
  /** One sentence: what is proposed and the main reason. */
  takeaway: string;
  /** The facts that most often make the lead approach the best fit, with the steps they hold for. */
  drivers: Tally[];
  /** Confirming these systems' APIs would move this many steps to API integration. */
  apiSwitch: { systems: string[]; steps: number };
  /** Step ids behind the headline numbers, for showing names. */
  aiStepIds: string[];
  mustStayStepIds: string[];
  forNowStepIds: string[];
  approvalStepIds: string[];
  /** Why this approach is proposed, in plain words, one paragraph per entry. */
  narrative: { title: string; text: string }[];
  /** Share of scored steps recommended for automation, 0 to 1. */
  automationFit: number;
  aiSteps: number;
  approvalSteps: number;
  knownShare: number;
  confidence: Confidence;
  keyQuestions: KeyQuestion[];
  cautions: Caution[];
  potential: Computed<Range>;
  hours: Computed<{ today: Range; automatable: Range }>;
  money: Computed<{ automatable: Range; currency: string }>;
  questions: StepQuestion[];
  /** Readiness, ease of implementation, value and where the process sits among candidates. */
  priority: Priority;
}

const LEAD_TITLE: Record<Approach, string> = {
  rpa: 'RPA-led automation', api: 'API-led integration', ai_assist: 'AI-assisted automation', agent: 'Agent-led automation', human: 'Keep with people',
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const mostCommon = (items: string[]): { text: string; count: number } | null => {
  const counts = new Map<string, number>();
  for (const i of items.filter(Boolean)) counts.set(i, (counts.get(i) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  return top ? { text: top[0], count: top[1] } : null;
};

const PER_YEAR: Record<string, number> = { day: 250, week: 52, month: 12, quarter: 4, year: 1 };
/** Yearly volume from the process-level volume metric, as a range. */
export function yearlyVolume(m: ProcessModel): Computed<Range> {
  const v = processMetric(m, 'volume');
  if (!v) return { computable: false, reason: 'The process volume is not known.' };
  const per = periodOf(v);
  if (!per) return { computable: false, reason: `The period of "${v.label}" is not clear.` };
  const [lo, hi] = v.range ?? [v.value!, v.value!];
  return { computable: true, value: [lo * PER_YEAR[per], hi * PER_YEAR[per]] };
}

export function assessProcess(model: ProcessModel, options: { rate?: Rate | null; settings?: AssessmentSettings } = {}): ProcessAssessment {
  const steps = scoreSteps(model);
  const scored = steps.filter(s => !s.alreadyAutomated);
  const n = scored.length;
  const nameOf = (id: string) => model.steps.find(s => s.id === id)?.name ?? id;
  const counts = { rpa: 0, api: 0, ai_assist: 0, agent: 0, human: 0 } as Record<Approach, number>;
  for (const s of scored) counts[s.winner]++;
  const effort = effortOf(model);
  const weights = effort.every(e => e.effort !== null) && effort.some(e => e.effort! > 0)
    ? new Map(effort.map(e => [e.id, e.effort! * (e.share ?? 1)])) : null;
  const weightOf = (s: StepScore) => weights?.get(s.stepId) ?? 1;
  // The ranking compares approaches on the steps that are open to automation at all.
  const open = scored.filter(s => !s.mustStayHuman);
  const total = open.reduce((t, s) => t + weightOf(s), 0) || 1;

  // ---- ranking
  const order = [...AUTOMATION];
  const rows = order.map(approach => ({
    approach,
    score: open.length ? Math.round(open.reduce((t, s) => t + scoreOf(s, approach) * weightOf(s), 0) / total) : 0,
    stepsWon: counts[approach],
    stepsFit: scored.filter(s => scoreOf(s, approach) >= FIT.possible).length,
  })).sort((a, b) => b.score - a.score || b.stepsWon - a.stepsWon || order.indexOf(a.approach) - order.indexOf(b.approach));
  const apiIfConfirmed = scored.filter(s => s.apiWouldWin).length;
  const systemsToConfirm = [...new Set(scored.filter(s => s.apiWouldWin).flatMap(s => s.questions.map(q => model.systems.find(x => x.id === q.target.id)?.name ?? '')))].filter(Boolean);

  const ranking: RankedApproach[] = rows.map((r, i) => {
    const a = r.approach;
    const won = scored.filter(s => s.winner === a);
    const notWon = scored.filter(s => s.winner !== a);
    const strength = mostCommon(won.flatMap(s => s.scores[0].factors.filter(f => f.known && f.value >= 0.7).map(f => f.text)));
    const held = mostCommon(notWon.map(s => limiter(s.scores.find(x => x.approach === a)!)));
    const why = [
      r.stepsWon ? `Best fit for ${r.stepsWon} of ${plural(n, 'step')}` : `Not the best fit for any of the ${plural(n, 'step')}`,
      r.stepsFit > r.stepsWon ? `; it could do ${r.stepsFit}.` : '.',
      strength ? ` Its strongest ground: ${lower(strength.text)} (${plural(strength.count, 'step')}).` : '',
      held ? ` Most often held back because ${lower(held.text.replace(/\.$/, ''))} (${plural(held.count, 'step')}).` : '',
    ].join('');
    let toWin = '';
    if (i > 0) {
      if (a === 'api') toWin = apiIfConfirmed ? `If the APIs of ${systemsToConfirm.join(', ')} are confirmed for this work, API integration becomes the best fit for ${plural(apiIfConfirmed, 'more step')}.` : 'It would rank higher only if more systems had a confirmed API covering the work.';
      else if (a === 'rpa') toWin = 'It would rank higher if more steps had written rules, structured input and stable screens.';
      else if (a === 'ai_assist') toWin = 'It ranks higher only where documents or free text have to be read and no complete rules exist.';
      else toWin = 'It is justified only where the path of the work cannot be fixed in advance and all five agent conditions are shown to hold.';
    }
    const tally = (t: { text: string; count: number } | null): Tally | null => (t ? { text: t.text.replace(/\.$/, ''), steps: t.count } : null);
    return { ...r, rank: i + 1, why, strength: tally(strength), heldBack: tally(held), toWin };
  });

  const automatedSteps = n - counts.human;
  const lead = automatedSteps > 0 ? ranking.find(r => r.stepsWon > 0 && r.rank === 1)?.approach ?? [...ranking].sort((a, b) => b.stepsWon - a.stepsWon)[0].approach : null;
  const aiSteps = counts.ai_assist + counts.agent;
  const approvalSteps = scored.filter(s => s.winner !== 'human' && s.human === 'approve').length;

  const splitParts = [
    ...AUTOMATION.filter(a => counts[a]).sort((a, b) => counts[b] - counts[a]).map(a => `${APPROACH_LABEL[a]} for ${counts[a]}`),
    ...(counts.human ? [`${counts.human} ${counts.human === 1 ? 'stays' : 'stay'} with people`] : []),
  ];
  const already = steps.length - n;
  const split = n === 0 ? 'There are no steps to assess yet.' : `Of ${plural(n, 'step')} people do today: ${splitParts.join(', ')}.${already ? ` ${plural(already, 'step')} ${already === 1 ? 'is' : 'are'} already done by a system.` : ''}`;
  const verdict = n === 0 ? 'Nothing to assess yet' : lead ? LEAD_TITLE[lead] : 'Keep the process with people for now';

  // ---- confidence and the questions that matter
  const knownShare = n ? scored.reduce((t, s) => t + s.knownShare, 0) / n : 1;
  const confidence: Confidence = knownShare >= 0.8 ? 'high' : knownShare >= 0.5 ? 'medium' : 'low';
  const byKey = new Map<string, KeyQuestion>();
  for (const s of scored) for (const u of s.unknowns) {
    const k = byKey.get(u.key) ?? { key: u.key, question: u.general, steps: 0 };
    k.steps++;
    byKey.set(u.key, k);
  }
  const keyQuestions = [...byKey.values()].sort((a, b) => b.steps - a.steps || a.key.localeCompare(b.key)).slice(0, 6);

  // ---- cautions
  const rework = scored.filter(s => s.rework).length;
  const rulesOf = (s: typeof model.steps[number]) => { const f = stepTrait(model, s, 'rulesComplete'); return f && f.status !== 'unknown' ? f.value : null; };
  const ruleSteps = model.steps.filter(s => rulesOf(s) !== null);
  const unstable = ruleSteps.filter(s => rulesOf(s) === false).length;
  const hours = hoursOf(model, scored);
  const automatableYear = hours.computable ? hours.value!.automatable[1] : null;
  const cautions: Caution[] = [
    { id: 'redesign_first', label: 'Simplify the process first', fired: n > 0 && rework / n >= THRESHOLDS.redesignReworkShare,
      reason: `${rework} of ${plural(n, 'step')} ${rework === 1 ? 'is' : 'are'} rework or duplicate entry (caution at ${Math.round(THRESHOLDS.redesignReworkShare * 100)}% or more). Remove them before automating.` },
    { id: 'hold_for_instability', label: 'Stabilise the rules first', fired: ruleSteps.length > 0 && unstable / ruleSteps.length >= THRESHOLDS.instabilityIncompleteRulesShare,
      reason: `${unstable} of ${plural(ruleSteps.length, 'step')} with known rules have incomplete or unstable rules (caution at ${Math.round(THRESHOLDS.instabilityIncompleteRulesShare * 100)}% or more).` },
    { id: 'not_worth_automating', label: 'Volume may not justify automation', fired: automatableYear !== null && automatableYear < THRESHOLDS.minimumAutomatableHoursPerYear,
      reason: automatableYear === null ? `Not checked: ${hours.reason ?? ''}` : `At most ${Math.round(automatableYear)} hands-on hours a year could be automated (caution below ${THRESHOLDS.minimumAutomatableHoursPerYear}).` },
  ];

  // ---- why this approach, in words
  const narrative: ProcessAssessment['narrative'] = [];
  if (n > 0) {
    const first = ranking[0], second = ranking[1], third = ranking[2];
    if (lead) {
      const l = ranking.find(r => r.approach === lead)!;
      narrative.push({ title: `Why ${lower(LEAD_TITLE[lead])}`, text: `${APPROACH_LABEL[lead]} scores ${l.score} out of 100 across the ${plural(open.length, 'step')} open to automation, the highest of the four approaches. ${l.why} ${automatedSteps === n ? 'Every step can be automated.' : `${plural(automatedSteps, 'step')} of ${n} can be automated on what is known.`}` });
    } else {
      narrative.push({ title: 'Why not automate yet', text: `No approach reaches ${FIT.possible} out of 100 on any step with what is known. The closest is ${APPROACH_LABEL[first.approach]} at ${first.score}. ${first.why}` });
    }
    const others = [first, second, third].filter(r => r.approach !== lead).slice(0, 2);
    narrative.push({ title: 'Why the others rank lower', text: others.map(r => `${APPROACH_LABEL[r.approach]} ranks ${['first', 'second', 'third', 'fourth'][r.rank - 1]} with ${r.score}. ${r.why} ${r.toWin}`.trim()).join(' ') });
    narrative.push({
      title: 'Where AI is needed',
      text: aiSteps === 0
        ? 'AI is not needed for any step. Where the work follows written rules on structured data, rule-based automation does it at lower cost and risk; AI and agents carry a fixed complexity penalty in the scoring and did not earn their place here.'
        : `AI is needed in ${aiSteps} of ${plural(n, 'step')}: ${scored.filter(s => s.aiNeeded).slice(0, 4).map(s => `"${nameOf(s.stepId)}"`).join(', ')}${aiSteps > 4 ? ' and others' : ''}. In those steps documents or free text have to be read, or no complete rules exist, and a person reviews the output. The other ${plural(n - aiSteps, 'step')} do not need AI.`,
    });
    if (counts.human || approvalSteps) {
      const kept = scored.filter(s => s.winner === 'human');
      const must = kept.filter(s => !s.forNow), forNow = kept.filter(s => s.forNow);
      narrative.push({
        title: 'What stays with people',
        text: [
          must.length ? `${plural(must.length, 'step')} ${must.length === 1 ? 'needs' : 'need'} a person because of judgment, accountability or physical work: ${must.slice(0, 4).map(s => `"${nameOf(s.stepId)}"`).join(', ')}${must.length > 4 ? ' and others' : ''}.` : '',
          forNow.length ? `${plural(forNow.length, 'step')} ${forNow.length === 1 ? 'stays' : 'stay'} with a person for now only because too little is known to recommend automation.` : '',
          approvalSteps ? `${plural(approvalSteps, 'automated step')} ${approvalSteps === 1 ? 'keeps' : 'keep'} a person's approval because ${approvalSteps === 1 ? 'it moves' : 'they move'} money or cannot be undone.` : '',
        ].filter(Boolean).join(' '),
      });
    }
    narrative.push({
      title: 'How firm this is',
      text: `${Math.round(knownShare * 100)}% of the facts behind the recommendations are known, so confidence is ${confidence}.${keyQuestions.length ? ` The answers that would firm it up most: ${keyQuestions.slice(0, 3).map(q => `${lower(q.question).replace(/\?$/, '')} (${plural(q.steps, 'step')})`).join('; ')}.` : ''} The scores come from fixed weights, so the same facts always give the same result.`,
    });
  }

  // ---- the same explanation as data, for showing at a glance
  const leadSteps = lead ? scored.filter(s => s.winner === lead) : [];
  const driverCounts = new Map<string, number>();
  for (const st of leadSteps) for (const f of st.scores[0].factors) if (f.known && f.value >= 0.7) driverCounts.set(f.text, (driverCounts.get(f.text) ?? 0) + 1);
  const drivers: Tally[] = [...driverCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([text, steps]) => ({ text, steps }));
  const takeaway = n === 0 ? 'Add the process steps to assess it.'
    : !lead ? 'No step can be recommended for automation on what is known so far.'
      : `${APPROACH_LABEL[lead]} is the best fit for ${counts[lead]} of the ${plural(open.length, 'step')} open to automation${drivers.length ? `, mainly because ${drivers.slice(0, 2).map(d => lower(d.text)).join(' and ')}` : ''}.`;

  // ---- benefit
  const potential = potentialOf(model, scored);
  let money: ProcessAssessment['money'] = { computable: false, reason: 'No cost rate has been entered.' };
  if (options.rate && hours.computable) {
    const r = options.rate.amount;
    money = { computable: true, value: { automatable: [hours.value!.automatable[0] * r, hours.value!.automatable[1] * r], currency: options.rate.currency }, note: `At ${options.rate.currency} ${r} an hour, entered by ${options.rate.enteredBy}.` };
  } else if (options.rate && !hours.computable) money = { computable: false, reason: hours.reason ?? '' };

  const questions = scored.flatMap(s => s.questions).filter((q, i, all) => all.findIndex(x => x.question === q.question) === i);
  const priority = prioritise(model, { scored, cautions, volume: yearlyVolume(model), automationShare: s => AUTOMATION_SHARE[s.winner], apiSwitch: { systems: systemsToConfirm, steps: apiIfConfirmed }, keyQuestions, settings: options.settings ?? DEFAULT_SETTINGS });
  return {
    priority,
    steps, assessed: n, candidates: open.length, alreadyAutomated: already, counts, ranking, lead, verdict, split, narrative,
    takeaway, drivers, apiSwitch: { systems: systemsToConfirm, steps: apiIfConfirmed },
    aiStepIds: scored.filter(x => x.aiNeeded).map(x => x.stepId), mustStayStepIds: scored.filter(x => x.winner === 'human' && !x.forNow).map(x => x.stepId),
    forNowStepIds: scored.filter(x => x.forNow).map(x => x.stepId), approvalStepIds: scored.filter(x => x.winner !== 'human' && x.human === 'approve').map(x => x.stepId),
    automationFit: n ? automatedSteps / n : 0, aiSteps, approvalSteps, knownShare, confidence, keyQuestions, cautions, potential, hours, money, questions,
  };
}

function effortOf(model: ProcessModel) {
  return model.steps.map(s => {
    const e = s.traits?.effortMinutes, sh = s.traits?.sharePercent;
    return {
      id: s.id,
      effort: e && e.status !== 'unknown' && e.value !== null ? e.value : null,
      share: sh && sh.status !== 'unknown' && sh.value !== null ? sh.value / 100 : null,
    };
  });
}

function potentialOf(model: ProcessModel, scored: StepScore[]): Computed<Range> {
  const rows = effortOf(model).filter(r => scored.some(s => s.stepId === r.id));
  if (!rows.length) return { computable: false, reason: 'There are no steps.' };
  const missing = rows.filter(r => r.effort === null).length;
  if (missing) return { computable: false, reason: `Effort is missing on ${missing} of ${rows.length} steps.` };
  const weight = (r: typeof rows[number]) => r.effort! * (r.share ?? 1);
  const total = rows.reduce((t, r) => t + weight(r), 0);
  if (total === 0) return { computable: false, reason: 'The stated effort adds up to zero.' };
  const auto = (i: 0 | 1) => rows.reduce((t, r) => t + weight(r) * AUTOMATION_SHARE[scored.find(x => x.stepId === r.id)!.winner][i], 0);
  const sharesMissing = rows.filter(r => r.share === null).length;
  return { computable: true, value: [auto(0) / total, auto(1) / total], ...(sharesMissing ? { note: `Weighted as if all cases pass through the ${sharesMissing} steps whose share is not stated.` } : {}) };
}

function hoursOf(model: ProcessModel, scored: StepScore[]): Computed<{ today: Range; automatable: Range }> {
  const vol = yearlyVolume(model);
  if (!vol.computable) return { computable: false, reason: vol.reason ?? '' };
  const rows = effortOf(model).filter(r => scored.some(s => s.stepId === r.id));
  const noEffort = rows.filter(r => r.effort === null).length;
  if (noEffort) return { computable: false, reason: `Effort is missing on ${noEffort} of ${rows.length} steps.` };
  const noShare = rows.filter(r => r.share === null).length;
  if (noShare) return { computable: false, reason: `The share of cases is missing on ${noShare} of ${rows.length} steps.` };
  const minutesPerCase = rows.reduce((t, r) => t + r.effort! * r.share!, 0);
  const auto = (i: 0 | 1) => rows.reduce((t, r) => t + r.effort! * r.share! * AUTOMATION_SHARE[scored.find(x => x.stepId === r.id)!.winner][i], 0);
  const [lo, hi] = vol.value!;
  return { computable: true, value: { today: [lo * minutesPerCase / 60, hi * minutesPerCase / 60], automatable: [lo * auto(0) / 60, hi * auto(1) / 60] } };
}
