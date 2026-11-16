// What was looked up in a process's sources, kept on the server for everyone (package 4 of docs/next-plan.md;
// table process_source_looks). The look itself and its rules are in sourceLook.ts; this file says how a
// browser writes it so no page loses what another found: every change is a step (note what was sent, add
// what came back, the allowance ran out, "Not right"), applied to the server's latest copy and saved with
// the version it was read at. When another page wrote in between, the save is refused, and the step is
// applied again to the newer copy. A step may also give up (`Skip`): a page about to send questions gives
// up when the newer copy shows another page has just sent some.
import { addLook, noteSent, noteStopped, waitingUntil, AUTO_LOOK, type LookLimit, type SourceLook } from './sourceLook.ts';
import type { Suggestion } from './suggest.ts';
import type { TriageItem } from '../questions/triage.ts';

/** One process's shared look: the look, and the suggestions set aside with "Not right". */
export interface SharedLook { look: SourceLook | null; dismissed: string[] }
/** As the server holds it: with the count of writes it was read at. */
export interface StoredLook extends SharedLook { version: number }

/** Where the shared look is kept: read the latest copy; save one read at `version` (null: there is none yet), or learn that another page wrote first (null). */
export interface LookServer {
  get(): Promise<StoredLook | null>;
  save(next: SharedLook, version: number | null): Promise<number | null>;
}

export type LookStep = (s: SharedLook) => SharedLook | typeof Skip;
/** A step's answer when it should not be written after all. */
export const Skip = Symbol('skip');

export const emptyShared = (): SharedLook => ({ look: null, dismissed: [] });
/** At most this many "Not right" keys are kept (the table's limit). */
export const DISMISSED_KEPT = 500;

/**
 * Applies a step to the server's latest copy and saves it; when another page saved in between, applies it
 * again to the newer copy. Returns what was saved, `Skip` when the step gave up, or null after `tries`
 * refusals in a row (the caller keeps its own copy and tries at the next step).
 */
export async function commitStep(server: LookServer, step: LookStep, tries = 5): Promise<SharedLook | typeof Skip | null> {
  for (let i = 0; i < tries; i++) {
    const stored = await server.get();
    const next = step(stored ? { look: stored.look, dismissed: stored.dismissed } : emptyShared());
    if (next === Skip) return Skip;
    const saved = await server.save({ look: next.look, dismissed: next.dismissed.slice(-DISMISSED_KEPT) }, stored ? stored.version : null);
    if (saved !== null) return next;
  }
  return null;
}

// ---- The steps -----------------------------------------------------------------------------------

/**
 * Note that these questions are about to be sent. On its own (`manual` false) the step gives up when the
 * latest copy shows a call still within its wait: another page is looking, or has just lost its answer.
 */
export const sendStep = (sources: string, items: TriageItem[], now: number, manual = false, limit: LookLimit = AUTO_LOOK): LookStep => s =>
  !manual && waitingUntil(s.look, sources, now, limit) !== null ? Skip : { ...s, look: noteSent(s.look, sources, items, now) };

/** Add what one call brought back. */
export const answerStep = (sources: string, run: { items: TriageItem[]; found: Suggestion[]; passages: number; tokens: number }): LookStep => s =>
  ({ ...s, look: addLook(s.look, sources, run) });

/** The month's AI allowance is used up. */
export const stoppedStep = (sources: string, now: number): LookStep => s => ({ ...s, look: noteStopped(s.look, sources, now) });

/** "Not right" on some suggestions, or "Show dismissed suggestions again" on others; other people's stay. */
export const dismissStep = (add: string[], remove: string[] = []): LookStep => s => {
  const gone = new Set(remove);
  return { ...s, dismissed: [...new Set([...s.dismissed.filter(k => !gone.has(k)), ...add])] };
};

/**
 * Once, after the release: a browser that already holds a look of the current sources hands it to the
 * server when the server has none for them, so nothing is looked up again. What the server holds wins.
 */
export const handOverStep = (local: SharedLook, sources: string): LookStep => s => {
  const serverHas = Boolean(s.look && s.look.sources === sources);
  const localHas = Boolean(local.look && local.look.sources === sources);
  if (serverHas || !localHas) return Skip;
  return { look: local.look, dismissed: [...new Set([...s.dismissed, ...local.dismissed])] };
};
