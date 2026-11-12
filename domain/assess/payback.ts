// Cost and payback, only from figures people enter: the cost of an hour of the work today, what the
// automation costs to build once, and what it costs to run each year. Nothing is assumed: without a
// figure the result says which one is missing. Where the hours are only an upper bound, so is every
// figure that follows from them, and the payback says only how soon it could be at best.
import type { Computed, Range } from './process.ts';
import type { Priority } from './priority.ts';

export interface Costs { build: number | null; running: number | null; enteredBy: string }

export interface Payback {
  currency: string;
  /** Value a year of the hours automation could take: at least and at most (at least is 0 for an upper bound). */
  value: Range;
  /** Value less the running cost, a year. */
  savings: Range;
  /** True when both ends are calculated; false when only the best case is known. */
  exact: boolean;
  /** Months until the build cost is earned back, at best and at worst. Worst is null when not known; 'never' when the savings can be zero or less. */
  months: { best: number | null; worst: number | 'never' | null };
  /** Savings over three years less the build cost. */
  net3y: Range;
  missing: string[];
}

export const PAYBACK_YEARS = 3;

export function paybackOf(value: Priority['value'], rate: { amount: number; currency: string } | null, costs: Costs | null): Computed<Payback> {
  if (!value.computable) return { computable: false, reason: `The hours are not known yet. ${value.reason}` };
  if (!rate) return { computable: false, reason: 'Enter the cost of an hour of this work to turn hours into money.' };
  const v = value.value!;
  const worth: Range = [v.exact ? v.hours[0] * rate.amount : 0, v.hours[1] * rate.amount];
  const running = costs?.running ?? 0, build = costs?.build ?? null;
  const savings: Range = [worth[0] - running, worth[1] - running];
  const missing = [...(build === null ? ['the build cost'] : []), ...(costs?.running === null || !costs ? ['the running cost a year'] : [])];
  const monthsAt = (s: number) => (build === null ? null : s > 0 ? Math.round((build * 12 / s) * 10) / 10 : null);
  const best = monthsAt(savings[1]);
  const worst: Payback['months']['worst'] = build === null ? null : !v.exact ? null : savings[0] <= 0 ? 'never' : monthsAt(savings[0]);
  const net3y: Range = [savings[0] * PAYBACK_YEARS - (build ?? 0), savings[1] * PAYBACK_YEARS - (build ?? 0)];
  return { computable: true, value: { currency: rate.currency, value: worth, savings, exact: v.exact, months: { best, worst }, net3y, missing } };
}
