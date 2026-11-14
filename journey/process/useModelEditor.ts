// Edits to the Process Model: each is an operation from domain/processModel/patch.ts, applied to
// the working draft (started on the first edit), shown at once, and saved as a JSON Patch.
// Saves run one at a time so each carries the sequence number of the one before. When the server
// says the draft moved on (409), the draft is reloaded and the operation is run again once.
import React from 'react';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { ModelOpError, type OpResult } from '../../domain/processModel/patch.ts';
import { StoreError, type JourneyStore } from '../store/types.ts';

export type ModelOp = (m: ProcessModel) => OpResult;

export interface ModelEditor {
  model: ProcessModel;
  saving: boolean;
  error: string | null;
  clearError(): void;
  /** Applies an edit; resolves true when it was saved. */
  apply(op: ModelOp, summary: string): Promise<boolean>;
  /** The last saved edit, for showing what it changed downstream. */
  lastChange: LastChange | null;
}
export interface LastChange { before: ProcessModel; after: ProcessModel; summary: string; at: number }

interface Draft { revisionId: string; seq: number; model: ProcessModel }

export function useModelEditor(store: JourneyStore, processId: string, initial: { model: ProcessModel; working: { id: string; seq: number } | null }, onSaved: () => void): ModelEditor {
  const [model, setModel] = React.useState(initial.model);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastChange, setLastChange] = React.useState<LastChange | null>(null);
  const draft = React.useRef<Draft | null>(initial.working ? { revisionId: initial.working.id, seq: initial.working.seq, model: initial.model } : null);
  const queue = React.useRef<Promise<unknown>>(Promise.resolve());
  const pending = React.useRef(0);

  // Adopt a model loaded by the page (for example after History or approval) when nothing is pending.
  React.useEffect(() => {
    if (pending.current > 0) return;
    setModel(initial.model);
    draft.current = initial.working ? { revisionId: initial.working.id, seq: initial.working.seq, model: initial.model } : null;
  }, [initial.model, initial.working?.id, initial.working?.seq]);

  const ensureDraft = async (fresh = false): Promise<Draft> => {
    if (draft.current && !fresh) return draft.current;
    const d = await store.startDraft(processId);
    draft.current = { revisionId: d.revisionId, seq: d.seq, model: d.model };
    return draft.current;
  };

  const run = async (op: ModelOp, summary: string): Promise<boolean> => {
    let d: Draft;
    try { d = await ensureDraft(); } catch (e) { setError((e as Error).message); return false; }
    for (let attempt = 0; attempt < 2; attempt++) {
      let r: OpResult;
      try { r = op(d.model); } catch (e) {
        setError(e instanceof ModelOpError ? e.message : 'This change could not be made.');
        return false;
      }
      if (r.patch.length === 0) return true;
      setModel(r.model);
      try {
        const { seq } = await store.savePatch(d.revisionId, d.seq, r.patch, 'user', summary);
        draft.current = { revisionId: d.revisionId, seq, model: r.model };
        setLastChange({ before: d.model, after: r.model, summary, at: Date.now() });
        return true;
      } catch (e) {
        if (e instanceof StoreError && e.status === 409 && attempt === 0) {
          try { d = await ensureDraft(true); continue; } catch { /* report below */ }
        }
        setError((e as Error).message);
        try { const again = await ensureDraft(true); setModel(again.model); } catch { setModel(d.model); }
        return false;
      }
    }
    return false;
  };

  const apply = (op: ModelOp, summary: string) => {
    pending.current++;
    setSaving(true);
    setError(null);
    const p = queue.current.then(() => run(op, summary)).finally(() => {
      pending.current--;
      if (pending.current === 0) { setSaving(false); onSaved(); }
    });
    queue.current = p.catch(() => undefined);
    return p;
  };

  return { model, saving, error, clearError: () => setError(null), apply, lastChange };
}
