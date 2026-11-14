// What Ask Avala answers about, from where the person is (docs/product-plan.md, "Ask Avala: the plan",
// stage 1). The button is in the top bar on every page; the panel says what it is asking about.
//
// On a process page it is that process; on the Delivery board it is that board; elsewhere it is the whole
// workspace. In the panel the person can pick another process or board, or widen to the whole workspace.
import type { JourneyRoute } from '../workspace/route.ts';

export type AskScope =
  | { kind: 'process'; processId: string }
  /** A board; with no project yet, the workspace's first board. */
  | { kind: 'board'; projectId: string | null }
  /** The whole workspace: My work, Processes, Settings, or picked in the panel. */
  | { kind: 'workspace' };

/** A choice in the panel's picker: "w" (the workspace), "p:<process id>" or "b:<board id>". */
export const pickOf = (s: AskScope): string => (s.kind === 'process' ? `p:${s.processId}` : s.kind === 'board' ? (s.projectId ? `b:${s.projectId}` : '') : 'w');

/** The scope for a page, or what the person picked in the panel (which wins). */
export function askScope(route: JourneyRoute, picked: string | null = null): AskScope {
  if (picked === 'w') return { kind: 'workspace' };
  if (picked?.startsWith('p:')) return { kind: 'process', processId: picked.slice(2) };
  if (picked?.startsWith('b:')) return { kind: 'board', projectId: picked.slice(2) };
  if (route.page === 'process') return { kind: 'process', processId: route.processId };
  if (route.page === 'board') return { kind: 'board', projectId: route.projectId ?? null };
  return { kind: 'workspace' };
}

/** A process can be asked about once it has steps: before that its record holds nothing to answer from. */
export const askable = (model: { steps: unknown[] } | null | undefined): boolean => Boolean(model && model.steps.length > 0);
