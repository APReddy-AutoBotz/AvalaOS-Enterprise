// Change impact on screen: what an edit changes downstream (the assessment, document sections,
// requirements and work items), from `changeImpact` in domain/docs/impact.ts. Shown before a delete or
// a canvas save is confirmed, and after an inline edit is saved. Nothing here is stored.
import React from 'react';
import type { JourneyStore } from '../store/types.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { changeImpact, impactDetails, impactSummary, isEmptyImpact, type Impact, type ImpactContext } from '../../domain/docs/impact.ts';
import type { ModelEditor, ModelOp } from './useModelEditor.ts';
import { SidePanel } from './widgets.tsx';

/** What the preview compares against: the decisions, settings and the stored requirements and work items. */
export function useImpactContext(store: JourneyStore, processId: string, workspaceId: string, refresh?: unknown): ImpactContext | null {
  const [ctx, setCtx] = React.useState<ImpactContext | null>(null);
  React.useEffect(() => {
    let live = true;
    Promise.all([store.getAssessmentDecisions(processId), store.getSettings(workspaceId).catch(() => null), store.listRequirements(processId), store.listProposals(processId)])
      .then(([decisions, s, requirements, proposals]) => { if (live) setCtx({ decisions, ...(s ? { settings: s.settings } : {}), requirements, proposals }); })
      .catch(() => { /* no preview without them; the edit itself still works */ });
    return () => { live = false; };
  }, [store, processId, workspaceId, refresh]);
  return ctx;
}

/** The impact an edit would have, or null when it cannot be worked out (the edit itself reports its own error). */
export function previewImpact(ctx: ImpactContext | null, model: ProcessModel, op: ModelOp): Impact | null {
  if (!ctx) return null;
  try {
    const r = op(model);
    return r.patch.length ? changeImpact(model, r.model, ctx) : null;
  } catch { return null; }
}

export function ImpactDetails({ impact }: { impact: Impact }) {
  const groups = impactDetails(impact);
  if (!groups.length) return <p className="text-sm text-slate-600">Nothing downstream changes.</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">Worked out from the process as it was before and after the change. Documents, requirements and work items follow the process on their own; your edits to them are kept and marked "Needs review", and items on the board are never changed for you.</p>
      {groups.map(g => (
        <section key={g.heading} aria-label={g.heading}>
          <h3 className="font-display text-sm font-semibold text-slate-900">{g.heading}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-800">{g.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </section>
      ))}
    </div>
  );
}

/** A line under the editor after each saved edit: what it changed, with the details one click away. */
export function LastChangeImpact({ editor, context }: { editor: ModelEditor; context: ImpactContext | null }) {
  const last = editor.lastChange;
  const impact = React.useMemo(() => (last && context ? changeImpact(last.before, last.after, context) : null), [last, context]);
  const [open, setOpen] = React.useState(false);
  const [hidden, setHidden] = React.useState<number | null>(null);
  if (!last || !impact || hidden === last.at) return null;
  const empty = isEmptyImpact(impact);
  return (
    <div role="status" data-testid="change-impact" className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl bg-slate-50 px-4 py-2.5 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
      <span><span className="font-semibold text-slate-900">{last.summary}.</span> {impactSummary(impact)}</span>
      <span className="ml-auto flex gap-3">
        {!empty && <button type="button" onClick={() => setOpen(true)} className="font-semibold text-[#002C4B] hover:underline">See what changes</button>}
        <button type="button" onClick={() => setHidden(last.at)} className="text-slate-500 hover:text-slate-900">Dismiss</button>
      </span>
      {open && <SidePanel title="What this change affects" onClose={() => setOpen(false)}><ImpactDetails impact={impact} /></SidePanel>}
    </div>
  );
}
