// The stored requirements follow an action at once, so nothing that reads them (Work items, the evidence
// pack, Ask Avala, the board) sees a list from before it: a switch of the answer, a decided approach removed
// or changed, a person's choice for one step withdrawn. What such an action alone brought is retired on its
// own (domain/requirements/retire.ts). If the list cannot be saved now, Documents brings it up to date when
// it opens; nothing is lost.
import type { JourneyStore } from '../store/types.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { Decisions } from '../../domain/assess/decisions.ts';
import { emptyDecisions } from '../../domain/assess/decisions.ts';
import { requirementsOnChoices, requirementsOnSwitch } from '../../domain/requirements/switch.ts';
import { linkedCodes } from '../../domain/requirements/retire.ts';

async function linkedOf(store: JourneyStore, processId: string) {
  const [proposals, testEdits] = await Promise.all([store.listProposals(processId).catch(() => []), store.listTestEdits(processId).catch(() => [])]);
  return linkedCodes(proposals, testEdits);
}

/** After the answer, or the decided approach, changed from `before` to `after`. Throws when it cannot save. */
export async function followSwitch(store: JourneyStore, processId: string, before: ProcessModel, after: ProcessModel): Promise<void> {
  const [decisions, stored, linked] = await Promise.all([store.getAssessmentDecisions(processId), store.listRequirements(processId), linkedOf(store, processId)]);
  const rows = requirementsOnSwitch(before, after, decisions ?? emptyDecisions(), stored, linked);
  if (rows?.length) await store.saveRequirements(processId, rows);
}

/** After people's choices for steps were saved. Never throws: Documents catches up when it opens. */
export async function followChoices(store: JourneyStore, processId: string, model: ProcessModel, before: Decisions, after: Decisions): Promise<void> {
  try {
    if (!Object.values(before.overrides).some(o => after.overrides[o.stepId]?.approach !== o.approach)) return;
    const [stored, linked] = await Promise.all([store.listRequirements(processId), linkedOf(store, processId)]);
    const rows = requirementsOnChoices(model, before, after, stored, linked);
    if (rows?.length) await store.saveRequirements(processId, rows);
  } catch { /* Documents re-derives the list when it opens. */ }
}
