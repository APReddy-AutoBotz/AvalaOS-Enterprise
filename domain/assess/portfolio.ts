// The portfolio: every assessed process side by side, in the order to take them. Derived from each
// process's own assessment; nothing is typed in here and no AI ranks anything.
import type { ProcessAssessment } from './process.ts';
import { PRIORITY, type Quadrant, type ReadinessState } from './priority.ts';
import type { Approach } from './scoring.ts';

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

export function buildPortfolio(items: { id: string; name: string; assessment: ProcessAssessment }[]): Portfolio {
  const rows = items.filter(i => i.assessment.assessed > 0).map(({ id, name, assessment: a }) => {
    const p = a.priority;
    return {
      id, name, rank: 0, lead: a.lead, verdict: a.verdict, fit: a.automationFit, ease: p.ease?.score ?? null,
      hours: p.value.computable ? p.value.value!.hours[1] : null, exact: p.value.computable ? p.value.value!.exact : false,
      quadrant: p.placement.placed ? p.placement.quadrant! : null, possible: p.placement.possible,
      readiness: p.readiness.state, inputsKnown: p.inputs.share,
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
