// One process, one page: a header with its status and the six stages. Internal versions
// (edit counts, content hashes, schema versions) are only shown in the History drawer.
import React from 'react';
import { revisionStatus, STAGES, type StageId } from '../../domain/workspace/route.ts';
import { gaps } from '../../domain/processModel/selectors.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { JourneyStore, ProcessRow, RevisionRow, Workspace } from '../store/types.ts';
import type { Nav } from '../JourneyApp.tsx';
import { Button, cx, EmptyState, ErrorNote, messageOf, Spinner } from '../ui.tsx';
import { HistoryDrawer } from './HistoryDrawer.tsx';
import { useModelEditor } from '../process/useModelEditor.ts';
import { ProcessEditor } from '../process/ProcessEditor.tsx';

const TONE = {
  neutral: 'border-slate-300 bg-slate-100 text-slate-700',
  draft: 'border-sky-200 bg-sky-50 text-sky-800',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  changed: 'border-amber-300 bg-amber-50 text-amber-900',
} as const;

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
  const canEdit = workspace !== null && workspace.role !== 'viewer';
  const canApprove = Boolean(workspace?.canApprove && working && (!approved || working.seq > 0));

  return (
    <div>
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
        <a href="/processes" className="hover:text-slate-800" onClick={e => { e.preventDefault(); nav.go({ page: 'processes' }); }}>Processes</a>
        <span className="mx-2" aria-hidden>/</span>
        <span className="text-slate-700">{process.name}</span>
      </nav>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">{process.name}</h1>
          <span data-testid="revision-status" className={cx('mt-2 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold', TONE[status.tone])}>{status.label}</span>
        </div>
        <div className="flex items-center gap-2">
          {canApprove && working && (
            <Button variant="secondary" disabled={busy} onClick={() => act(() => store.approve(working.id, working.seq))}>Approve</Button>
          )}
          <Button variant="ghost" onClick={() => setHistoryOpen(true)} aria-haspopup="dialog">History</Button>
        </div>
      </div>

      <nav aria-label="Stages" className="mt-6 border-b border-slate-200">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {STAGES.map(s => (
            <li key={s.id}>
              <a
                href={`/process/${process.id}/${s.id}`}
                aria-current={s.id === stage ? 'page' : undefined}
                onClick={e => { e.preventDefault(); nav.go({ page: 'process', processId: process.id, stage: s.id }); }}
                className={cx('block whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold',
                  s.id === stage ? 'border-[#FFBC03] text-[#002C4B]' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800')}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <ErrorNote message={error} />
      <section aria-label={STAGES.find(s => s.id === stage)!.label} className="mt-6" data-testid="stage-panel">
        {stage === 'process' && model
          ? <ProcessStage store={store} processId={process.id} model={model} working={working ? { id: working.id, seq: working.seq } : null} canEdit={canEdit} me={me} onSaved={load} />
          : <StagePanel stage={stage} model={model} canEdit={canEdit} busy={busy} onStart={() => act(() => store.startDraft(process.id))} onGo={id => nav.go({ page: 'process', processId: process.id, stage: id })} />}
      </section>

      {historyOpen && <HistoryDrawer store={store} processId={process.id} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

function ProcessStage({ store, processId, model, working, canEdit, me, onSaved }: {
  store: JourneyStore; processId: string; model: ProcessModel; working: { id: string; seq: number } | null; canEdit: boolean; me: string; onSaved: () => void;
}) {
  const editor = useModelEditor(store, processId, { model, working }, onSaved);
  return (
    <div className="space-y-6">
      <ModelSummary model={editor.model} />
      <ProcessEditor editor={editor} canEdit={canEdit} me={me} sourceTitle={id => id} />
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
      return <EmptyState title="No documents yet">The business requirements (BRD), process definition (PDD), functional (FRD) and solution design (SDD) documents are written from the process model and the assessment. Your edits to them are kept.</EmptyState>;
    case 'flows':
      return <EmptyState title="No flows yet">The as-is and to-be flows are drawn from the process model as editable BPMN diagrams.</EmptyState>;
    case 'work-items':
      return <EmptyState title="No work items yet">Proposed work items come from the approved design, with descriptions, acceptance criteria and links to requirements. You review and select them before they reach the delivery board.</EmptyState>;
  }
}

function ModelSummary({ model }: { model: ProcessModel }) {
  const open = gaps(model).length + model.openQuestions.filter(q => q.status === 'open').length;
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
