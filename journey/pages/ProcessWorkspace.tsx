// One process, one page: a header with its status and the six stages. Internal versions
// (edit counts, content hashes, schema versions) are only shown in the History drawer.
import React from 'react';
import { revisionStatus, STAGES, type StageId } from '../../domain/workspace/route.ts';
import { openItemCount } from '../../domain/processModel/selectors.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { JourneyStore, ProcessRow, RevisionRow, Workspace } from '../store/types.ts';
import type { Nav } from '../JourneyApp.tsx';
import { Button, cx, EmptyState, ErrorNote, messageOf, Spinner, Tag } from '../ui.tsx';
import { HistoryDrawer } from './HistoryDrawer.tsx';
import { useModelEditor } from '../process/useModelEditor.ts';
import { ProcessEditor } from '../process/ProcessEditor.tsx';
import { SourcesStage } from '../process/SourcesStage.tsx';
import { AssessmentStage } from '../process/AssessmentStage.tsx';
import { FlowsStage } from '../process/FlowsStage.tsx';
import { WorkItemsStage } from '../process/WorkItemsStage.tsx';
import { DocumentsStage } from '../process/DocumentsStage.tsx';
import { SourceContext } from '../process/widgets.tsx';
import { quoteInContext } from '../../domain/workspace/sources.ts';
import type { IngestSegment } from '../../domain/ingest/segment.ts';
import type { SourceRow } from '../store/types.ts';

const TONE = { neutral: 'neutral', draft: 'info', approved: 'ok', changed: 'warn' } as const;

interface Loaded {
  process: ProcessRow;
  workspace: Workspace | null;
  revisions: RevisionRow[];
  /** The model shown: the working draft if there is one, else the approved revision. */
  model: ProcessModel | null;
}

export function ProcessWorkspace({ store, nav, processId, stage }: { store: JourneyStore; nav: Nav; processId: string; stage: StageId }) {
  const [data, setData] = React.useState<Loaded | null | 'missing'>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [me, setMe] = React.useState('');
  React.useEffect(() => { store.currentUser().then(u => setMe(u?.email ?? '')).catch(() => {}); }, [store]);

  // Sources, for titles and for showing a quote in its passage.
  const [sources, setSources] = React.useState<SourceRow[]>([]);
  const loadSources = React.useCallback(() => { store.listSources(processId).then(setSources).catch(() => {}); }, [store, processId]);
  React.useEffect(() => { loadSources(); }, [loadSources]);
  const segmentCache = React.useRef(new Map<string, Promise<IngestSegment[]>>());
  const sourceCtx = React.useMemo(() => ({
    title: (key: string) => sources.find(s => s.key === key)?.title ?? 'A source no longer in this process',
    load: async (ref: { sourceId: string; locator: object; excerpt: string }) => {
      const src = sources.find(s => s.key === ref.sourceId);
      if (!src) return null;
      if (!segmentCache.current.has(src.id)) segmentCache.current.set(src.id, store.getSourceSegments(src.id));
      return quoteInContext(await segmentCache.current.get(src.id)!, ref as any);
    },
  }), [sources, store]);

  const load = React.useCallback(async () => {
    try {
      const process = await store.getProcess(processId);
      if (!process) { setData('missing'); return; }
      const [revisions, workspaces] = await Promise.all([store.listRevisions(processId), store.listWorkspaces()]);
      const current = revisions.find(r => r.state === 'working') ?? revisions.find(r => r.state === 'approved');
      const model = current ? await store.getModel(current.id) : null;
      setData({ process, workspace: workspaces.find(w => w.id === process.workspaceId) ?? null, revisions, model });
    } catch (e) {
      setError(messageOf(e));
    }
  }, [store, processId]);
  React.useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };

  if (data === 'missing') {
    return <EmptyState title="Process not found" action={<Button variant="secondary" onClick={() => nav.go({ page: 'processes' })}>All processes</Button>}>It may have been removed, or you may not have access to its workspace.</EmptyState>;
  }
  if (!data) return error ? <ErrorNote message={error} /> : <Spinner />;

  const { process, workspace, revisions, model } = data;
  const status = revisionStatus(revisions);
  const working = revisions.find(r => r.state === 'working');
  const approved = revisions.find(r => r.state === 'approved');
  const current = working ?? approved;
  const canEdit = workspace !== null && workspace.role !== 'viewer';
  const canApprove = Boolean(workspace?.canApprove && working && (!approved || working.seq > 0));
  const hasSteps = Boolean(model && model.steps.length > 0);

  return (
    <div>
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
        <a href="/processes" className="hover:text-slate-800" onClick={e => { e.preventDefault(); nav.go({ page: 'processes' }); }}>Processes</a>
        <span className="mx-2 text-slate-300" aria-hidden>/</span>
        <span className="text-slate-700">{process.name}</span>
      </nav>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">{process.name}</h1>
          <Tag data-testid="revision-status" tone={TONE[status.tone]} className="px-2 py-1 text-xs">{status.label}</Tag>
        </div>
        <div className="flex items-center gap-2">
          {canApprove && working && (
            <Button variant="secondary" disabled={busy} onClick={() => act(() => store.approve(working.id, working.seq))}>Approve</Button>
          )}
          <Button variant="ghost" onClick={() => setHistoryOpen(true)} aria-haspopup="dialog">History</Button>
        </div>
      </div>

      {/* The journey: six stages in order. A tick means the stage has what the next ones need;
          a stage that is still waiting for the process steps is shown quieter, and can still be opened. */}
      <nav aria-label="Stages" className="mt-5">
        <ol className="flex overflow-x-auto rounded-xl border border-slate-200 bg-white px-1.5">
          {STAGES.map((s, i) => {
            const here = s.id === stage;
            const done = s.id === 'sources' ? sources.length > 0 : s.id === 'process' ? hasSteps : false;
            const waiting = !done && !here && s.id !== 'sources' && (s.id === 'process' ? false : !hasSteps);
            return (
              <li key={s.id} className="flex items-center">
                {i > 0 && <svg viewBox="0 0 8 12" className="mx-0.5 h-3 w-2 shrink-0 text-slate-300" aria-hidden><path d="m1.5 1.5 4.5 4.5-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                <a
                  href={`/process/${process.id}/${s.id}`}
                  aria-current={here ? 'page' : undefined}
                  title={waiting ? 'Needs the process steps first' : undefined}
                  onClick={e => { e.preventDefault(); nav.go({ page: 'process', processId: process.id, stage: s.id }); }}
                  className={cx('flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition-colors',
                    here ? 'border-[#FFBC03] text-[#002C4B]' : cx('border-transparent hover:text-slate-900', waiting ? 'text-slate-400' : 'text-slate-600'))}
                >
                  <span aria-hidden data-n={i + 1} className={cx('flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums', !(done && !here) && 'before:content-[attr(data-n)]',
                    here ? 'bg-[#002C4B] text-white' : done ? 'bg-emerald-600 text-white' : waiting ? 'bg-slate-100 text-slate-400' : 'bg-slate-200 text-slate-700')}>
                    {done && !here ? <svg viewBox="0 0 12 12" className="h-3 w-3"><path d="M2.8 6.3 5 8.4l4.2-4.7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
                  </span>
                  {s.label}
                </a>
              </li>
            );
          })}
        </ol>
      </nav>

      <ErrorNote message={error} />
      <section aria-label={STAGES.find(s => s.id === stage)!.label} className="mt-6" data-testid="stage-panel">
        <SourceContext.Provider value={sourceCtx}>
        {stage === 'sources'
          ? <SourcesStage store={store} processId={process.id} workspaceId={process.workspaceId} canEdit={canEdit} onModelChanged={load} onSourcesChanged={loadSources} goToProcess={() => nav.go({ page: 'process', processId: process.id, stage: 'process' })} />
          : stage === 'assessment' && model && current
          ? <AssessmentStage store={store} processId={process.id} workspaceId={process.workspaceId} model={model} working={working ? { id: working.id, seq: working.seq } : null}
              revisionId={current.id} canEdit={canEdit} me={me} sources={sources} onSaved={load} />
          : stage === 'documents' && model && current && model.steps.length > 0
          ? <DocumentsStage store={store} processId={process.id} workspaceId={process.workspaceId} model={model} sources={sources} canEdit={canEdit} working={working ? { id: working.id, seq: working.seq } : null} onSaved={load} me={me} onSourcesChanged={loadSources} approvedRevision={approved ? approved.revNo : null} approvedRevisionId={approved && current.state === 'working' ? approved.id : null} onFix={() => nav.go({ page: 'process', processId: process.id, stage: 'process' })}
              revision={{ label: `Revision ${current.revNo}${current.state === 'working' ? ', working draft' : ''}`, state: current.state === 'approved' ? 'approved' : 'working', date: new Date(current.approvedAt ?? current.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) }} />
          : stage === 'work-items' && model && model.steps.length > 0
          ? <WorkItemsStage store={store} processId={process.id} workspaceId={process.workspaceId} model={model} canEdit={canEdit} onOpenBoard={id => nav.go({ page: 'board', projectId: id })} />
          : stage === 'flows' && model && model.steps.length > 0
          ? <FlowsStage store={store} processId={process.id} model={model} working={working ? { id: working.id, seq: working.seq } : null} canEdit={canEdit} onSaved={load} />
          : stage === 'process' && model
          ? <ProcessStage store={store} processId={process.id} model={model} working={working ? { id: working.id, seq: working.seq } : null} canEdit={canEdit} me={me} onSaved={load} />
          : <StagePanel stage={stage} model={model} canEdit={canEdit} busy={busy} onStart={() => act(() => store.startDraft(process.id))} onGo={id => nav.go({ page: 'process', processId: process.id, stage: id })} />}
        </SourceContext.Provider>
      </section>

      {historyOpen && <HistoryDrawer store={store} processId={process.id} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

function ProcessStage({ store, processId, model, working, canEdit, me, onSaved }: {
  store: JourneyStore; processId: string; model: ProcessModel; working: { id: string; seq: number } | null; canEdit: boolean; me: string; onSaved: () => void;
}) {
  const editor = useModelEditor(store, processId, { model, working }, onSaved);
  const { title } = React.useContext(SourceContext);
  return (
    <div className="space-y-6">
      <ModelSummary model={editor.model} />
      <ProcessEditor editor={editor} canEdit={canEdit} me={me} sourceTitle={title} />
    </div>
  );
}

function StagePanel({ stage, model, canEdit, busy, onStart, onGo }: { stage: StageId; model: ProcessModel | null; canEdit: boolean; busy: boolean; onStart: () => void; onGo: (s: StageId) => void }) {
  const hasSteps = Boolean(model && model.steps.length > 0);
  switch (stage) {
    case 'sources':
      return (
        <EmptyState title="No sources yet">
          Sources are what the process model is built from: meeting transcripts (.vtt, .srt or a text export), procedures and policies (Word, PDF, Markdown),
          trackers (Excel) and flowcharts. Every extracted fact keeps a link back to the sentence it came from.
        </EmptyState>
      );
    case 'process':
      if (!model) {
        return (
          <EmptyState title="The process model has not been started" action={canEdit ? <Button disabled={busy} onClick={onStart}>Start the process model</Button> : undefined}>
            The model holds the steps, roles, systems, rules, exceptions and open questions of this process. It starts empty; nothing is filled in until it comes from a source or from you.
          </EmptyState>
        );
      }
      return <ModelSummary model={model} />;
    case 'assessment':
      return <EmptyState title="Nothing to assess yet" action={!hasSteps ? <Button variant="secondary" onClick={() => onGo(model ? 'process' : 'sources')}>{model ? 'Go to Process' : 'Go to Sources'}</Button> : undefined}>The assessment recommends, step by step, what to keep with people, what simple rules or an existing API can do, and where automation or AI is worth it. It needs the process steps first.</EmptyState>;
    case 'documents':
      return <EmptyState title="No documents yet" action={!hasSteps ? <Button variant="secondary" onClick={() => onGo(model ? 'process' : 'sources')}>{model ? 'Go to Process' : 'Go to Sources'}</Button> : undefined}>The business requirements (BRD), process definition (PDD), functional (FRD) and solution design (SDD) documents are written from the process model and the assessment. They need the process steps first.</EmptyState>;
    case 'flows':
      return <EmptyState title="No flows yet" action={!hasSteps ? <Button variant="secondary" onClick={() => onGo(model ? 'process' : 'sources')}>{model ? 'Go to Process' : 'Go to Sources'}</Button> : undefined}>The As-Is and To-Be maps are drawn from the process steps, and the flow can be edited as a BPMN diagram. They need the process steps first.</EmptyState>;
    case 'work-items':
      return <EmptyState title="No work items yet">Proposed work items come from the approved design, with descriptions, acceptance criteria and links to requirements. You review and select them before they reach the delivery board.</EmptyState>;
  }
}

function ModelSummary({ model }: { model: ProcessModel }) {
  const open = openItemCount(model);
  const tiles: [string, number][] = [
    ['Steps', model.steps.length],
    ['Roles', model.roles.length],
    ['Systems', model.systems.length],
    ['Rules', model.rules.length],
    ['Exceptions', model.exceptions.length],
    ['Open questions and gaps', open],
  ];
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([label, n]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <dt className="text-xs font-medium text-slate-500">{label}</dt>
            <dd className="mt-1 font-display text-2xl font-semibold text-slate-900">{n}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
