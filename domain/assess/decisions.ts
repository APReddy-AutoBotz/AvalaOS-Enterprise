// What people decide about an assessment: overrides of a step's recommendation (always with a
// rationale) and the cost rate used to show hours as money. Stored as one array of entries.
import type { Approach, StepScore } from './scoring.ts';
import type { Rate } from './process.ts';
import type { Costs } from './payback.ts';
import type { MapShape } from '../flowchart/shape.ts';

export interface Override { stepId: string; approach: Approach; rationale: string; by: string; at: string }
/** A person's choice of the shape every map of the process is drawn in (docs/next-plan.md, package 1). */
export interface MapChoice { shape: MapShape; by: string; at: string }
export interface Decisions { overrides: Record<string, Override>; rate: Rate | null; costs: Costs | null; map?: MapChoice | null }

type Entry = ({ kind: 'step' } & Override) | ({ kind: 'rate' } & Rate & { at: string }) | ({ kind: 'cost' } & Costs & { at: string }) | ({ kind: 'map' } & MapChoice);

export const emptyDecisions = (): Decisions => ({ overrides: {}, rate: null, costs: null, map: null });
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
    } else if (e?.kind === 'map' && (e.shape === 'swimlanes' || e.shape === 'simple')) {
      d.map = { shape: e.shape, by: typeof e.by === 'string' ? e.by : '', at: typeof e.at === 'string' ? e.at : '' };
    }
  }
  return d;
}

export function decisionsToEntries(d: Decisions, at = new Date().toISOString()): Entry[] {
  return [
    ...Object.values(d.overrides).map(o => ({ kind: 'step' as const, ...o })),
    ...(d.rate ? [{ kind: 'rate' as const, ...d.rate, at }] : []),
    ...(d.costs ? [{ kind: 'cost' as const, ...d.costs, at }] : []),
    ...(d.map ? [{ kind: 'map' as const, ...d.map }] : []),
  ];
}

export class DecisionError extends Error {}

/** Records an override. A rationale is required; overriding to the scoring's own answer removes it. */
export function withOverride(d: Decisions, result: StepScore, args: { approach: Approach; rationale: string; by: string; at?: string }): Decisions {
  const next: Decisions = { ...d, overrides: { ...d.overrides } };
  if (args.approach === (result.recommended ?? result.winner)) { delete next.overrides[result.stepId]; return next; }
  if (!args.rationale.trim()) throw new DecisionError('Say why you are overriding the recommendation.');
  next.overrides[result.stepId] = { stepId: result.stepId, approach: args.approach, rationale: args.rationale.trim(), by: args.by, at: args.at ?? new Date().toISOString() };
  return next;
}

export function withoutOverride(d: Decisions, stepId: string): Decisions {
  const overrides = { ...d.overrides };
  delete overrides[stepId];
  return { ...d, overrides };
}

export function withRate(d: Decisions, rate: Rate | null): Decisions {
  if (rate && (!(rate.amount > 0) || !rate.currency.trim())) throw new DecisionError('Enter a positive amount and a currency.');
  return { ...d, rate };
}

/** Records the build and running costs (null clears one); both null clears them. */
export function withCosts(d: Decisions, costs: Costs | null): Decisions {
  if (costs && [costs.build, costs.running].some(v => v !== null && !(Number.isFinite(v) && v >= 0))) throw new DecisionError('Costs are amounts of zero or more.');
  const keep = costs && (costs.build !== null || costs.running !== null) ? costs : null;
  return { ...d, costs: keep };
}

/**
 * Records the shape a person chose for the maps. Choosing the shape Avala OS suggests removes the
 * choice, so the suggestion follows the process again as it changes.
 */
export function withMapShape(d: Decisions, args: { shape: MapShape; suggested: MapShape; by: string; at?: string }): Decisions {
  return { ...d, map: args.shape === args.suggested ? null : { shape: args.shape, by: args.by, at: args.at ?? new Date().toISOString() } };
}

/** The approach in effect for a step: the override if there is one, else the scoring's recommendation. */
export function effectiveApproach(result: StepScore, d: Decisions): { approach: Approach; override: Override | null } {
  const o = d.overrides[result.stepId];
  return o ? { approach: o.approach, override: o } : { approach: result.winner, override: null };
}
