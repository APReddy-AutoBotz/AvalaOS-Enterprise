// Flows: the As-Is and To-Be maps drawn from the model, and the As-Is flow as an editable BPMN
// diagram. A saved drawing is read back and its changes are listed in words; nothing reaches the
// model until the person applies them, as one edit.
import React from 'react';
import type { JourneyStore } from '../store/types.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { assessProcess } from '../../domain/assess/process.ts';
import { flowPicture, modeFromScore } from '../../domain/flowchart/svg.ts';
import { modelToBpmn, parseBpmn } from '../../domain/flowchart/bpmn.ts';
import { modelToBpmnVertical } from '../../domain/flowchart/svg.ts';
import { applyFlowPlan, lintFlow, planFlowEdits, type FlowPlan } from '../../domain/flowchart/edit.ts';
import { useModelEditor } from './useModelEditor.ts';
import type { CanvasApi } from './BpmnCanvas.tsx';
import { Button, cx, ErrorNote, messageOf, Spinner } from '../ui.tsx';
import { impactSummary } from '../../domain/docs/impact.ts';
import { ImpactDetails, previewImpact, useImpactContext } from './ImpactNote.tsx';

const BpmnCanvas = React.lazy(() => import('./BpmnCanvas.tsx'));
type View = 'asis' | 'tobe' | 'edit';

const save = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
};

export function FlowsStage({ store, processId, workspaceId, model: loaded, working, canEdit, onSaved }: {
  store: JourneyStore; processId: string; workspaceId: string; model: ProcessModel; working: { id: string; seq: number } | null; canEdit: boolean; onSaved: () => void;
}) {
  const editor = useModelEditor(store, processId, { model: loaded, working }, onSaved);
  const model = editor.model;
  const [view, setView] = React.useState<View>('asis');
  const [full, setFull] = React.useState(false);
  const api = React.useRef<CanvasApi | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [plan, setPlan] = React.useState<(FlowPlan & { lint: string[] }) | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const impactCtx = useImpactContext(store, processId, workspaceId);
  const impact = React.useMemo(() => (plan && plan.changes.length ? previewImpact(impactCtx, model, m => applyFlowPlan(m, plan)) : null), [plan, impactCtx, model]);

  const pictures = React.useMemo(() => {
    const a = assessProcess(model);
    const modes = new Map(a.steps.map(s => [s.stepId, modeFromScore(s.winner, s.alreadyAutomated, s.human)]));
    return { asis: flowPicture(model, { title: `As-Is map of ${model.meta.name}` }), tobe: flowPicture(model, { modes, title: `To-Be map of ${model.meta.name}` }) };
  }, [model]);
  // The editor shows the flow top to bottom like the maps; the download is the standard left-to-right
  // layout, which every BPMN tool reads.
  const xml = React.useMemo(() => modelToBpmnVertical(model), [model]);
  const downloadXml = React.useMemo(() => modelToBpmn(model), [model]);

  const review = async () => {
    if (!api.current) return;
    setError(null); setNote(null);
    try {
      const graph = parseBpmn(await api.current.save());
      const p = planFlowEdits(model, graph);
      setPlan({ ...p, lint: lintFlow(graph) });
    } catch (e) { setError(messageOf(e)); }
  };
  const applyPlan = async () => {
    if (!plan) return;
    setBusy(true); setError(null);
    const ok = await editor.apply(m => applyFlowPlan(m, plan), `Flow edited on the canvas: ${plan.changes.length} ${plan.changes.length === 1 ? 'change' : 'changes'}`);
    setBusy(false);
    if (ok) { setPlan(null); setDirty(false); setNote(`Saved ${plan.changes.length} ${plan.changes.length === 1 ? 'change' : 'changes'} to the process.`); }
  };
  const discard = async () => { setPlan(null); setDirty(false); setNote(null); await api.current?.load(xml); };
  // After a save the model changed: redraw the canvas from it so ids and layout match the model.
  React.useEffect(() => { if (view === 'edit' && api.current && !dirty) api.current.load(xml); }, [xml]); // eslint-disable-line react-hooks/exhaustive-deps

  const tab = (id: View, label: string) => (
    <button key={id} role="tab" aria-selected={view === id} onClick={() => { setView(id); setNote(null); }} className={cx('rounded-md px-3 py-1.5 text-sm font-semibold', view === id ? 'bg-white text-[#002C4B] shadow-sm' : 'text-slate-600 hover:text-slate-900')}>{label}</button>
  );
  const pic = view === 'tobe' ? pictures.tobe : pictures.asis;

  return (
    <div className="space-y-4" data-testid="flows-stage">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Flow view" className="inline-flex rounded-lg bg-slate-200/70 p-0.5">
          {tab('asis', 'As-Is map')}{tab('tobe', 'To-Be map')}{canEdit && tab('edit', 'Edit the As-Is flow')}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {view !== 'edit' && <button type="button" className="font-semibold text-[#002C4B] hover:underline" onClick={() => setFull(!full)} aria-pressed={full}>{full ? 'Fit to width' : 'Full size'}</button>}
          <Button variant="secondary" onClick={() => save(new Blob([downloadXml], { type: 'application/xml' }), `${model.meta.name} - As-Is.bpmn`)}>Download BPMN</Button>
        </div>
      </div>
      <ErrorNote message={error ?? editor.error} />
      {note && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">{note}</p>}

      {view !== 'edit' ? (
        <figure className="rounded-xl border border-slate-200 bg-white p-4" data-testid="flow-map">
          <figcaption className="mb-2 text-sm text-slate-600">{view === 'tobe' ? 'Each step coloured by how it will be done, from the assessment. Change the flow itself on the As-Is map.' : 'How the work flows today, one column per role. Drawn from the process model.'}</figcaption>
          <div className={cx(full ? 'max-h-[75vh] overflow-auto' : '[&_svg]:h-auto [&_svg]:max-w-full')} dangerouslySetInnerHTML={{ __html: pic.svg }} />
        </figure>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 ring-1 ring-inset ring-slate-200">
            <p><strong>You are editing the As-Is flow</strong>: how the work is done today, one column per role. The To-Be map is worked out from this flow and the assessment, so it follows on its own; to change how a step will be done, change its facts in Assessment.</p>
            <p className="mt-1 text-slate-600">Drag steps, draw connections, add or delete elements, rename by double-clicking, and drag a step into another role's column. Zoom with the buttons or Ctrl and the mouse wheel. Then <strong>Review changes</strong>: you see each change in words before it is saved.</p>
          </div>
          <React.Suspense fallback={<Spinner label="Opening the editor" />}>
            <BpmnCanvas xml={xml} onReady={a => { api.current = a; }} onChange={() => { setDirty(true); setPlan(null); }} />
          </React.Suspense>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={review} disabled={!dirty}>Review changes</Button>
            <Button variant="ghost" onClick={discard} disabled={!dirty}>Discard</Button>
            {editor.saving && <span className="text-sm text-slate-500">Saving…</span>}
          </div>
          {plan && (
            <section aria-label="Changes to save" className="rounded-xl border border-[#002C4B]/20 bg-white p-5" data-testid="flow-changes">
              <h3 className="font-display text-base font-semibold text-slate-900">{plan.changes.length ? `${plan.changes.length} ${plan.changes.length === 1 ? 'change' : 'changes'} to the process` : 'No changes to the process'}</h3>
              {plan.changes.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-800">{plan.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
              {plan.warnings.length > 0 && <ul className="mt-3 space-y-1 text-sm text-amber-900">{plan.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>}
              {plan.lint.length > 0 && <details className="mt-3 text-sm text-slate-700"><summary className="cursor-pointer font-semibold">{plan.lint.length} {plan.lint.length === 1 ? 'thing' : 'things'} to check in the flow</summary><ul className="mt-1 list-disc pl-5">{plan.lint.map((l, i) => <li key={i}>{l}</li>)}</ul></details>}
              {impact && (
                <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-inset ring-slate-200" data-testid="flow-impact">
                  <summary className="cursor-pointer"><span className="font-semibold text-slate-900">What this changes downstream.</span> {impactSummary(impact)}</summary>
                  <div className="mt-2"><ImpactDetails impact={impact} /></div>
                </details>
              )}
              <p className="mt-3 text-xs text-slate-500">Removing a step also removes it from exceptions, controls and open questions. Systems, facts and sources of kept steps are not changed.</p>
              <div className="mt-3 flex gap-2">
                <Button onClick={applyPlan} disabled={busy || !plan.changes.length}>{busy ? 'Saving…' : `Save ${plan.changes.length} ${plan.changes.length === 1 ? 'change' : 'changes'}`}</Button>
                <Button variant="ghost" onClick={() => setPlan(null)}>Keep editing</Button>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
