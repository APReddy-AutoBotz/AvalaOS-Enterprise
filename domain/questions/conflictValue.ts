// The value a resolved conflict writes, shared by the Process stage's Questions tab and Discovery (package B, review of
// 24 November 2026): a conflict about a field that holds a single number or text writes the chosen value into it.
import type { Conflict, ProcessModel } from '../processModel/types.ts';
import { getElement } from '../processModel/selectors.ts';

/** The value to write when a conflict is about a field that holds a single number or text. */
export function conflictValue(m: ProcessModel, c: Conflict, chosen: string): { value?: unknown } {
  const t = c.target;
  if (t.kind === 'metric' && t.field === 'value') {
    const n = Number(chosen.replace(/[, ]/g, '').match(/-?\d+(\.\d+)?/)?.[0]);
    return Number.isFinite(n) ? { value: n } : {};
  }
  const el = getElement(m, t) as Record<string, unknown> | undefined;
  if (t.field && el && typeof el[t.field] === 'string' && t.kind !== 'meta') return { value: chosen };
  return {};
}
