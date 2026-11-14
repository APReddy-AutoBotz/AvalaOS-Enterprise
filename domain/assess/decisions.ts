// What people decide about an assessment: overrides of a step's recommendation (always with a
// rationale) and the cost rate used to show hours as money. Stored as one array of entries.
import type { Approach, StepScore } from './scoring.ts';
import type { Rate } from './process.ts';
import type { Costs } from './payback.ts';

export interface Override { stepId: string; approach: Approach; rationale: string; by: string; at: string }
export interface Decisions { overrides: Record<string, Override>; rate: Rate | null; costs: Costs | null }

type Entry = ({ kind: 'step' } & Override) | ({ kind: 'rate' } & Rate & { at: string }) | ({ kind: 'cost' } & Costs & { at: string });

export const emptyDecisions = (): Decisions => ({ overrides: {}, rate: null, costs: null });
const amountOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

export function decisionsFromEntries(entries: unknown): Decisions {
  const d = emptyDecisions();
  if (!Array.isArray(entries)) return d;
  for (const e of entries as Entry[]) {
    if (e?.kind === 'step' && typeof e.stepId === 'string' && typeof e.rationale === 'string' && e.rationale.trim() && typeof e.approach === 'string') {
      d.overrides[e.stepId] = { stepId: e.stepId, approach: e.approach, rationale: e.rationale, by: e.by, at: e.at };
    } else if (e?.kind === 'rate' && typeof e.amount === 'number' && e.amount > 0 && typeof e.currency === 'string') {
      d.rate = { amount: e.amount, currency: e.currency, enteredBy: e.enteredBy };
    } else if (e?.kind === 'cost') {
      const build = amountOrNull(e.build), running = amountOrNull(e.running);
      if (build !== null || running !== null) d.costs = { build, running, enteredBy: typeof e.enteredBy === 'string' ? e.enteredBy : '' };
    }
  }
  return d;
}

export function decisionsToEntries(d: Decisions, at = new Date().toISOString()): Entry[] {
  return [
    ...Object.values(d.overrides).map(o => ({ kind: 'step' as const, ...o })),
    ...(d.rate ? [{ kind: 'rate' as const, ...d.rate, at }] : []),
    ...(d.costs ? [{ kind: 'cost' as const, ...d.costs, at }] : []),
  ];
}

export class DecisionError extends Error {}

/** Records an override. A rationale is required; overriding to the scoring's own answer removes it. */
export function withOverride(d: Decisions, result: StepScore, args: { approach: Approach; rationale: string; by: string; at?: string }): Decisions {
  const next: Decisions = { overrides: { ...d.overrides }, rate: d.rate, costs: d.costs };
  if (args.approach === (result.recommended ?? result.winner)) { delete next.overrides[result.stepId]; return next; }
  if (!args.rationale.trim()) throw new DecisionError('Say why you are overriding the recommendation.');
  next.overrides[result.stepId] = { stepId: result.stepId, approach: args.approach, rationale: args.rationale.trim(), by: args.by, at: args.at ?? new Date().toISOString() };
  return next;
}

export function withoutOverride(d: Decisions, stepId: string): Decisions {
  const overrides = { ...d.overrides };
  delete overrides[stepId];
  return { overrides, rate: d.rate, costs: d.costs };
}

export function withRate(d: Decisions, rate: Rate | null): Decisions {
  if (rate && (!(rate.amount > 0) || !rate.currency.trim())) throw new DecisionError('Enter a positive amount and a currency.');
  return { overrides: d.overrides, rate, costs: d.costs };
}

/** Records the build and running costs (null clears one); both null clears them. */
export function withCosts(d: Decisions, costs: Costs | null): Decisions {
  if (costs && [costs.build, costs.running].some(v => v !== null && !(Number.isFinite(v) && v >= 0))) throw new DecisionError('Costs are amounts of zero or more.');
  const keep = costs && (costs.build !== null || costs.running !== null) ? costs : null;
  return { overrides: d.overrides, rate: d.rate, costs: keep };
}

/** The approach in effect for a step: the override if there is one, else the scoring's recommendation. */
export function effectiveApproach(result: StepScore, d: Decisions): { approach: Approach; override: Override | null } {
  const o = d.overrides[result.stepId];
  return o ? { approach: o.approach, override: o } : { approach: result.winner, override: null };
}
