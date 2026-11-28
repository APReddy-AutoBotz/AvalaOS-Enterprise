// Save at the end of a call (package C, C3b), as one rule the page calls with the store's two writes passed in: the
// notes kept as a source first, then the one edit of the record. A retry after a failed edit reuses the source already
// kept and adds no second one; what failed is said plainly, with the notes' source when it was kept (review chat,
// 28 November 2026: when the edit threw after the source was kept in the same press, the page said nothing was saved).
// Who saved is a name, never an email address.
import type { ProcessModel } from '../processModel/types.ts';
import type { Op } from '../questions/answer.ts';
import type { CallState } from './kept.ts';
import { callEdit, callNotesSource, type CallCounts, type NotesSource, type Review, type ReviewContext, type SaveChoice } from './review.ts';
import { CALL_WORDS } from './words.ts';

/** A name for the notes' title: the person's name, else none (the title then names no one); never an email address. */
export const savedBy = (name: string | null | undefined): string | undefined => {
  const n = (name ?? '').trim();
  return n && !n.includes('@') ? n : undefined;
};

export interface SaveWrites {
  /** Keeps the notes as a source; throws when it cannot. */
  addSource(source: NotesSource): Promise<void>;
  /** Applies the edit to the record; the record as saved, or null when it was not saved (`error` says why when known). */
  apply(op: Op, summary: string): Promise<{ model: ProcessModel } | { error: string | null }>;
}

export type SaveResult =
  | { ok: true; key: string; before: ProcessModel; after: ProcessModel; counts: CallCounts }
  | { ok: false; key: string | null; error: string };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function saveCall(a: {
  s: CallState; review: Review; choice: SaveChoice; ctx: ReviewContext;
  takenKeys: readonly string[];
  /** The notes' source kept by an earlier press, when its edit failed: reused, never added again. */
  keptKey: string | null;
  by: { id: string | null; name: string | null | undefined };
  endedAt: string; at: string; date: string;
}, w: SaveWrites): Promise<SaveResult> {
  const name = savedBy(a.by.name);
  const source = callNotesSource(a.s, { takenKeys: a.takenKeys, ...(name ? { by: name } : {}), endedAt: a.endedAt, timeZone: a.ctx.timeZone });
  if (!source) return { ok: false, key: a.keptKey, error: 'There are no notes to keep.' };
  let key = a.keptKey;
  try {
    if (!key) { await w.addSource(source); key = source.key; }
    const edit = callEdit(a.s, a.review, a.choice, { ...a.ctx, source: { ...source, key }, date: a.date, by: { id: a.by.id, name: name ?? '' }, at: a.at });
    const r = await w.apply(edit.op, edit.summary);
    if (!('model' in r)) return { ok: false, key, error: CALL_WORDS.notSaved(r.error ?? 'The record could not be saved', key) };
    return { ok: true, key, before: a.ctx.model, after: r.model, counts: edit.counts };
  } catch (e) {
    // The local key: set in this same press once the source is kept, whatever the page's own state says yet.
    return { ok: false, key, error: key ? CALL_WORDS.notSaved(messageOf(e), key) : CALL_WORDS.notSavedNothing(messageOf(e)) };
  }
}
