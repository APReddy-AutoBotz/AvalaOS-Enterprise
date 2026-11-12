// What people decide about an assessment: overrides of a step's recommendation (always with a
// rationale) and the cost rate used to show hours as money. Stored as one array of entries.
import type { Mechanism, StepResult } from './rules.ts';
import type { Rate } from './rollup.ts';

export interface Override { stepId: string; mechanism: Mechanism; rationale: string; by: string; at: string }
export interface Decisions { overrides: Record<string, Override>; rate: Rate | null }

type Entry = ({ kind: 'step' } & Override) | ({ kind: 'rate' } & Rate & { at: string });

export const emptyDecisions = (): Decisions => ({ overrides: {}, rate: null });

export function decisionsFromEntries(entries: unknown): Decisions {
  const d = emptyDecisions();
  if (!Array.isArray(entries)) return d;
  for (const e of entries as Entry[]) {
    if (e?.kind === 'step' && typeof e.stepId === 'string' && typeof e.rationale === 'string' && e.rationale.trim()) {
      d.overrides[e.stepId] = { stepId: e.stepId, mechanism: e.mechanism, rationale: e.rationale, by: e.by, at: e.at };
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

/** Records an override. A rationale is required; overriding to the rules' own answer removes it. */
export function withOverride(d: Decisions, result: StepResult, args: { mechanism: Mechanism; rationale: string; by: string; at?: string }): Decisions {
  const next: Decisions = { overrides: { ...d.overrides }, rate: d.rate };
  if (args.mechanism === result.mechanism) { delete next.overrides[result.stepId]; return next; }
  if (!args.rationale.trim()) throw new DecisionError('Say why you are overriding the recommendation.');
  next.overrides[result.stepId] = { stepId: result.stepId, mechanism: args.mechanism, rationale: args.rationale.trim(), by: args.by, at: args.at ?? new Date().toISOString() };
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

/** Overrides apply to steps that still exist; the rules' own recommendation stays visible beside them. */
export function effectiveMechanism(result: StepResult, d: Decisions): { mechanism: Mechanism; override: Override | null } {
  const o = d.overrides[result.stepId];
  return o ? { mechanism: o.mechanism, override: o } : { mechanism: result.mechanism, override: null };
}
