// What a switch of the answer to "What do you want from this process?" does to the stored requirements
// (review of the third bundle, 17 November 2026). The requirements follow the steps each answer gives:
// "decided" can leave a step with a person, and its functional requirement is marked "source removed".
// So a switch between "Assess it and document it" and "already decided" (or of the decided approach)
// works the list out again and saves it in the same action, and nothing that reads the stored list
// (Work items, the evidence pack, Ask Avala, the board's "Upstream changed") sees a list from the other
// answer. A switch to or from "Document it as it is" leaves the stored list exactly as it is: such a
// process has no requirements of its own, and nothing it holds is marked removed.
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import type { Decisions } from '../assess/decisions.ts';
import { purposeOf } from '../plan/purpose.ts';
import { deriveRequirements } from './derive.ts';
import { reconcile, type StoredRequirement } from './register.ts';

const decidedKey = (m: ProcessModel) => {
  const d = m.meta.decidedApproach;
  return d ? `${d.approach}` : '';
};

/**
 * The rows to save after a switch from `before` to `after`, or null when the switch leaves the stored
 * list as it is: either side documented as it is, or nothing that decides a step's approach changed.
 */
export function requirementsOnSwitch(before: ProcessModel, after: ProcessModel, decisions: Decisions, stored: StoredRequirement[]): StoredRequirement[] | null {
  if (purposeOf(before) === 'as_is' || purposeOf(after) === 'as_is') return null;
  if (purposeOf(before) === purposeOf(after) && decidedKey(before) === decidedKey(after)) return null;
  return reconcile(deriveRequirements(after, assessProcess(after, { rate: decisions.rate, decisions })), stored).changed;
}
