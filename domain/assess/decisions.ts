// What people decide about an assessment: overrides of a step's recommendation (always with a
// rationale) and the cost rate used to show hours as money. Stored as one array of entries.
import type { Approach, StepScore } from './scoring.ts';
import type { Rate } from './process.ts';

export interface Override { stepId: string; approach: Approach; rationale: string; by: string; at: string }
export interface Decisions { overrides: Record<string, Override>; rate: Rate | null }

type Entry = ({ kind: 'step' } & Override) | ({ kind: 'rate' } & Rate & { at: string });

export const emptyDecisions = (): Decisions => ({ overrides: {}, rate: null });

export function decisionsFromEntries(entries: unknown): Decisions {
  const d = emptyDecisions();
  if (!Array.isArray(entries)) return d;
  for (const e of entries as Entry[]) {
    if (e?.kind === 'step' && typeof e.stepId === 'string' && typeof e.rationale === 'string' && e.rationale.trim() && typeof e.approach === 'string') {
      d.overrides[e.stepId] = { stepId: e.stepId, approach: e.approach, rationale: e.rationale, by: e.by, at: e.at };
    } else if (e?.kind === 'rate' && typeof e.amount === 'number' && e.amount > 0 && typeof e.currency === 'string') {
      d.rate = { amount: e.amount, currency: e.currency, enteredBy: e.enteredBy };
    }
  }
  return d;
}

export function decisionsToEntries(d: Decisions, at = new Date().toISOString()): Entry[] {
  return [
    ...Object.values(d.overrides).map(o => ({ kind: 'step' as const, ...o })),
    ...(d.rate ? [{ kind: 'rate' as const, ...d.rate, at }] : []),
  ];
}

export class DecisionError extends Error {}

/** Records an override. A rationale is required; overriding to the scoring's own answer removes it. */
export function withOverride(d: Decisions, result: StepScore, args: { approach: Approach; rationale: string; by: string; at?: string }): Decisions {
  const next: Decisions = { overrides: { ...d.overrides }, rate: d.rate };
  if (args.approach === result.winner) { delete next.overrides[result.stepId]; return next; }
  if (!args.rationale.trim()) throw new DecisionError('Say why you are overriding the recommendation.');
  next.overrides[result.stepId] = { stepId: result.stepId, approach: args.approach, rationale: args.rationale.trim(), by: args.by, at: args.at ?? new Date().toISOString() };
  return next;
}

export function withoutOverride(d: Decisions, stepId: string): Decisions {
  const overrides = { ...d.overrides };
  delete overrides[stepId];
  return { overrides, rate: d.rate };
}

export function withRate(d: Decisions, rate: Rate | null): Decisions {
  if (rate && (!(rate.amount > 0) || !rate.currency.trim())) throw new DecisionError('Enter a positive amount and a currency.');
  return { overrides: d.overrides, rate };
}

/** The approach in effect for a step: the override if there is one, else the scoring's recommendation. */
export function effectiveApproach(result: StepScore, d: Decisions): { approach: Approach; override: Override | null } {
  const o = d.overrides[result.stepId];
  return o ? { approach: o.approach, override: o } : { approach: result.winner, override: null };
}
