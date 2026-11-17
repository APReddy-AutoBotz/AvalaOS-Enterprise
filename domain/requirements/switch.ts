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
import { APPROACH_LABEL } from '../assess/scoring.ts';
import { orderedSteps } from '../processModel/selectors.ts';
import { decidedReason, retireLeftBehind, stepChoiceReason } from './retire.ts';

const decidedKey = (m: ProcessModel) => {
  const d = m.meta.decidedApproach;
  return d ? `${d.approach}` : '';
};

/**
 * The rows to save after a switch from `before` to `after`, or null when the switch leaves the stored
 * list as it is: either side documented as it is, or nothing that decides a step's approach changed.
 */
export function requirementsOnSwitch(before: ProcessModel, after: ProcessModel, decisions: Decisions, stored: StoredRequirement[], linked: ReadonlySet<string> = new Set()): StoredRequirement[] | null {
  if (purposeOf(before) === 'as_is' || purposeOf(after) === 'as_is') return null;
  if (purposeOf(before) === purposeOf(after) && decidedKey(before) === decidedKey(after)) return null;
  const next = reconcile(deriveRequirements(after, assessProcess(after, { rate: decisions.rate, decisions })), stored);
  // A decided approach removed or changed: what it alone brought is retired on its own (retire.ts).
  const was = before.meta.decidedApproach;
  if (!was || decidedKey(before) === decidedKey(after)) return next.changed;
  return retireLeftBehind(stored, next, { reason: decidedReason(APPROACH_LABEL[was.approach]), linked });
}

/**
 * The rows to save after people's choices for steps change (one withdrawn, or changed to another
 * approach), with what a withdrawn choice alone brought retired; null when no step's choice went away.
 */
export function requirementsOnChoices(model: ProcessModel, before: Decisions, after: Decisions, stored: StoredRequirement[], linked: ReadonlySet<string> = new Set()): StoredRequirement[] | null {
  if (purposeOf(model) === 'as_is') return null;
  const gone = Object.values(before.overrides).filter(o => after.overrides[o.stepId]?.approach !== o.approach);
  if (!gone.length) return null;
  const next = reconcile(deriveRequirements(model, assessProcess(model, { rate: after.rate, decisions: after })), stored);
  const steps = orderedSteps(model);
  const o = gone[0]!;
  const at = steps.findIndex(s => s.id === o.stepId);
  const reason = stepChoiceReason(APPROACH_LABEL[o.approach], at >= 0 ? at + 1 : null, steps[at]?.name ?? 'a step');
  return retireLeftBehind(stored, next, { reason, linked });
}
