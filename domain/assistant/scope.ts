// What Ask Avala answers about, from where the person is (docs/product-plan.md, "Ask Avala: the plan",
// stage 1). The button is in the top bar on every page; the panel says what it is asking about.
//
// Today only a process can be asked about: on a process page it is that process; elsewhere the person
// picks one in the panel. The board and the whole workspace come next in the plan, as scopes of their own.
import type { JourneyRoute } from '../workspace/route.ts';

export type AskScope =
  | { kind: 'process'; processId: string }
  /** No process is in view: the panel asks which one. */
  | { kind: 'choose' };

/** The scope for a page, or the process the person picked in the panel (which wins). */
export function askScope(route: JourneyRoute, picked: string | null = null): AskScope {
  if (picked) return { kind: 'process', processId: picked };
  if (route.page === 'process') return { kind: 'process', processId: route.processId };
  return { kind: 'choose' };
}

/** A process can be asked about once it has steps: before that its record holds nothing to answer from. */
export const askable = (model: { steps: unknown[] } | null | undefined): boolean => Boolean(model && model.steps.length > 0);
