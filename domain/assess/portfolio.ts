// The portfolio: every assessed process side by side, in the order to take them. Derived from each
// process's own assessment; nothing is typed in here and no AI ranks anything.
import type { ProcessAssessment } from './process.ts';
import { PRIORITY, type Quadrant, type ReadinessState } from './priority.ts';
import type { Approach } from './scoring.ts';
import { paybackOf, type Costs } from './payback.ts';

export interface PortfolioRow {
  id: string;
  name: string;
  rank: number;
  lead: Approach | null;
  verdict: string;
  /** Share of steps recommended for automation. */
  fit: number;
  ease: number | null;
  /** Upper end of the hours a year automation could take; null when not known. */
  hours: number | null;
  /** True when the hours are a calculated range, false when only an upper bound. */
  exact: boolean;
  quadrant: Quadrant | null;
  possible: Quadrant[];
  readiness: ReadinessState;
  inputsKnown: number;
  /** Months to pay back the build, at best and at worst, when the costs are entered. */
  payback: { best: number; worst: number | 'never' | null } | null;
}

export interface Portfolio {
  rows: PortfolioRow[];
  /** Processes with at least one step to assess. */
  assessed: number;
  /** Hours a year across the processes whose value is known (upper ends). */
  totalHours: number;
  /** The fewest processes that carry 80% of those hours, in order; empty when fewer than two have a value. */
  pareto: { ids: string[]; share: number; of: number };
}

/** Quick wins first, then major projects, fill-ins, not-now; processes not yet placed come last. */
export const QUADRANT_ORDER: Quadrant[] = ['quick_win', 'major_project', 'fill_in', 'not_now'];

export function buildPortfolio(items: { id: string; name: string; assessment: ProcessAssessment; rate?: { amount: number; currency: string } | null; costs?: Costs | null }[]): Portfolio {
  const rows = items.filter(i => i.assessment.assessed > 0).map(({ id, name, assessment: a, rate, costs }) => {
    const p = a.priority;
    const pb = paybackOf(p.value, rate ?? null, costs ?? null);
    const months = pb.computable && pb.value!.months.best !== null ? { best: pb.value!.months.best, worst: pb.value!.months.worst } : null;
    return {
      id, name, rank: 0, lead: a.lead, verdict: a.verdict, fit: a.automationFit, ease: p.ease?.score ?? null,
      hours: p.value.computable ? p.value.value!.hours[1] : null, exact: p.value.computable ? p.value.value!.exact : false,
      quadrant: p.placement.placed ? p.placement.quadrant! : null, possible: p.placement.possible,
      readiness: p.readiness.state, inputsKnown: p.inputs.share, payback: months,
    } as PortfolioRow;
  });
  const place = (r: PortfolioRow) => (r.quadrant ? QUADRANT_ORDER.indexOf(r.quadrant) : QUADRANT_ORDER.length);
  rows.sort((a, b) => place(a) - place(b) || (b.hours ?? -1) - (a.hours ?? -1) || (b.ease ?? -1) - (a.ease ?? -1) || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i + 1; });

  const valued = rows.filter(r => r.hours !== null && r.hours > 0).sort((a, b) => b.hours! - a.hours!);
  const totalHours = valued.reduce((t, r) => t + r.hours!, 0);
  const ids: string[] = [];
  let sum = 0;
  if (valued.length >= 2) for (const r of valued) { if (sum / totalHours >= PRIORITY.pareto) break; ids.push(r.id); sum += r.hours!; }
  return { rows, assessed: rows.length, totalHours, pareto: { ids, share: totalHours ? sum / totalHours : 0, of: valued.length } };
}

/**
 * What a process's card shows on My work and the Processes page: the lead approach, the hours and how
 * the steps people do today would be done. Null until the process has a step to assess.
 */
export interface ProcessCard {
  lead: Approach | null;
  /** Share of steps recommended for automation. */
  fit: number;
  /** Upper end of the hours a year automation could take; null when not known. */
  hours: number | null;
  exact: boolean;
  /** Steps people do today. */
  steps: number;
  /** Those steps by how they would be done: rules (RPA or an API), AI (assisted or agentic), or kept with people. */
  split: { rules: number; ai: number; people: number };
}

export function processCard(a: ProcessAssessment): ProcessCard | null {
  if (a.assessed === 0) return null;
  const v = a.priority.value, c = a.counts;
  return {
    lead: a.lead, fit: a.automationFit, steps: a.assessed,
    hours: v.computable ? v.value!.hours[1] : null, exact: v.computable ? v.value!.exact : false,
    split: { rules: c.rpa + c.api, ai: c.ai_assist + c.agent, people: c.human },
  };
}

/** Across several cards: how many processes are assessed, and the hours a year where the value is known (upper ends). */
export function cardTotals(cards: (ProcessCard | null)[]): { assessed: number; hours: number } {
  const have = cards.filter((c): c is ProcessCard => c !== null);
  return { assessed: have.length, hours: have.reduce((t, c) => t + (c.hours ?? 0), 0) };
}
