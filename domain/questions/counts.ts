// The first list's counts for one process, worked out the same way everywhere: My work, the Processes list,
// the Portfolio and the weekday email (journey-notify, which cannot use what a browser worked out). From the
// process's current model and what was looked up in its sources (the shared look, package 4 of
// docs/next-plan.md): what only people can answer now, the answers found to confirm, and what can wait. No AI.
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { triage } from './triage.ts';
import { planQuestions } from './firstList.ts';
import { foundFor, foundKeys, type SourceLook } from '../assistant/sourceLook.ts';

export interface FirstListCounts { now: number; found: number; wait: number }

/** The counts, or undefined for a process with no steps yet (it is counted from its stored questions). */
export function firstListCounts(model: ProcessModel | null | undefined, look: SourceLook | null = null, dismissed: readonly string[] = []): FirstListCounts | undefined {
  if (!model || !Array.isArray(model.steps) || !model.steps.length) return undefined;
  const t = triage(model, assessProcess(model));
  const plan = planQuestions(t, model, { found: foundKeys(foundFor(look, t, dismissed)) });
  return { now: plan.now.length, found: plan.found.length, wait: plan.wait.length };
}
