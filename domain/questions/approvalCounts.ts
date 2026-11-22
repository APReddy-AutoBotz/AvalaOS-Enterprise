// The two numbers on the approval confirmation (package 14 of docs/next-plan.md, part L; reused by
// package 16): how many open questions could still change what is being approved, and how many of those
// are left with someone. Counted from the triage, so repeats are merged as Closing the gaps lists them.
// Nothing is closed or changed here.
import type { ProcessModel } from '../processModel/types.ts';
import type { ProcessAssessment } from '../assess/process.ts';
import { purposeOf } from '../plan/purpose.ts';
import { GROUP_LABEL, groupLabel, triage } from './triage.ts';

export const SETTLES_DECIDED = 'Settles the decided approach';

export interface ApprovalCounts {
  /** Which group was counted: "Changes the recommendation" when assessing, "Settles the decided approach" when decided. */
  group: string;
  open: number;
  /** Of those, the questions left with a named person (deferred to someone). */
  leftWithSomeone: number;
}

/** Null when the process is documented as it is: nothing is being recommended or decided. */
export function approvalCounts(model: ProcessModel, assessment: ProcessAssessment): ApprovalCounts | null {
  const purpose = purposeOf(model);
  if (purpose === 'as_is') return null;
  const group = purpose === 'decided' ? SETTLES_DECIDED : GROUP_LABEL.decides;
  const items = triage(model, assessment).items.filter(i => groupLabel(i) === group);
  return { group, open: items.length, leftWithSomeone: items.filter(i => i.assignedTo).length };
}

/** The line on the confirmation, before the reason (part L's words). Null when there is nothing to count. */
export function approvalCountsLine(c: ApprovalCounts | null): string | null {
  if (!c) return null;
  const decided = c.group === SETTLES_DECIDED;
  if (c.open === 0) return decided ? 'No open question settles the decided approach.' : 'No open question could change the recommendation.';
  const verb = decided ? (c.open === 1 ? 'settles the decided approach' : 'settle the decided approach') : 'could change the recommendation';
  const left = c.open === 1 ? (c.leftWithSomeone ? 'it is left with someone' : 'it is not left with anyone') : `${c.leftWithSomeone} of them ${c.leftWithSomeone === 1 ? "is" : "are"} left with someone`;
  return `${c.open} open ${c.open === 1 ? 'question' : 'questions'} ${verb}; ${left}.`;
}
