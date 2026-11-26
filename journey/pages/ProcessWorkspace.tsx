// One process, one page: a header with its status and the six stages. Internal versions
// (edit counts, content hashes, schema versions) are only shown in the History drawer.
import { followSwitch } from '../process/requirementsFollow.ts';
import { purposeTag } from '../../domain/assess/decided.ts';
import { useProcessChanged } from '../processChanged.ts';
import { useAutoLook, useSharedLook } from '../process/sourceLook.ts';
import { BriefPanel } from '../process/BriefPanel.tsx';
import { TypicalPanel } from '../process/TypicalPanel.tsx';
import { typicalCounts } from '../../domain/reference/typical.ts';
import { briefFromFindings, briefSegments, readBrief, type BriefFinding } from '../../domain/plan/readBrief.ts';
import { adoptBrief } from '../../domain/processModel/patch.ts';
import React from 'react';
import { revisionStatus, STAGES, type StageId } from '../../domain/workspace/route.ts';
import { offMessage, stagesFor } from '../../domain/workspace/modules.ts';
import { offersPurpose, purposeOf, purposeOffMessage, stagesForProcess, whatFollows } from '../../domain/plan/purpose.ts';
import { openItemsNow } from '../../domain/questions/closedGaps.ts';
import { GAPS_MARK, questionsLanding } from '../../domain/work/home.ts';
import { openGaps } from '../process/openGaps.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { JourneyStore, ProcessRow, RevisionRow, Workspace } from '../store/types.ts';
import type { Nav } from '../JourneyApp.tsx';
import { Button, cx, EmptyState, ErrorNote, messageOf, Spinner, Tag } from '../ui.tsx';
import { HistoryDrawer } from './HistoryDrawer.tsx';
import { useModelEditor } from '../process/useModelEditor.ts';
import { ProcessEditor } from '../process/ProcessEditor.tsx';
import { useImpactContext } from '../process/ImpactNote.tsx';
import type { AppList } from '../process/ApplicationOffer.tsx';
import type { Application } from '../../domain/workspace/applications.ts';
import { SourcesStage } from '../process/SourcesStage.tsx';
import { AssessmentStage } from '../process/AssessmentStage.tsx';
import { FlowsStage } from '../process/FlowsStage.tsx';
import { WorkItemsStage } from '../process/WorkItemsStage.tsx';
import { DocumentsStage } from '../process/DocumentsStage.tsx';
import { ChooserContext, SourceContext, type Chooser } from '../process/widgets.tsx';
import { quoteInContext } from '../../domain/workspace/sources.ts';
import type { IngestSegment } from '../../domain/ingest/segment.ts';
import type { SourceRow } from '../store/types.ts';
import { ProcessPeople } from '../process/ProcessPeople.tsx';
import type { VersionStateRow } from '../store/types.ts';
import { keepFirstQuestion, UNNAMED_APPROVER, versionTag } from '../../domain/docs/versions.ts';
import { approvalTarget, offersApproval, offersKeep } from '../../domain/docs/approving.ts';
import { approvePrepared, longDate, prepareApproval, type PreparedApproval } from '../process/keepVersion.ts';
import { ApproveDialog } from '../process/ApproveDialog.tsx';

const TONE = { neutral: 'neutral', draft: 'info', approved: 'ok', changed: 'warn' } as const;

interface Loaded {
  process: ProcessRow;
  workspace: Workspace | null;
  revisions: RevisionRow[];
  /** The model shown: the working draft if there is one, else the approved revision. */
  model: ProcessModel | null;
  /** Where the process stands with its approved versions (package 14); null when the store could not say. */
  versions: VersionStateRow | null;
}

/** The owner's words for an approval that did not happen: "Not approved: {why}. The page has been reloaded." */
const notApproved = (e: unknown) => `Not approved: ${messageOf(e).replace(/[.\s]*$/, '')}. The page has been reloaded.`;

// Saves that go into the documents (the change record's kinds): after each, where the process stands with its
// approved versions is read again, so the tag says "unapproved changes" at once, whichever stage saved.
const DOCUMENT_WRITES = new Set(['savePatch', 'saveDocumentEdit', 'removeDocumentEdit', 'saveTestEdit', 'removeTestEdit', 'saveRequirements', 'saveAssessment', 'addSource', 'archiveSource']);
function watchWrites(store: JourneyStore, after: () => void): JourneyStore {
  return new Proxy(store, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      const fn = value.bind(target);
      return typeof key === 'string' && DOCUMENT_WRITES.has(key) ? (...args: unknown[]) => Promise.resolve(fn(...args)).then(r => { after(); return r; }) : fn;
    },
  });
}

/** The tag beside the name (package 14, part N item 2), with the revision's own words where nothing is approved. */
function tagOf(revisions: RevisionRow[], v: VersionStateRow | null): { label: string; tone: 'neutral' | 'info' | 'ok' | 'warn' } {
  const status = revisionStatus(revisions);
  const label = v ? versionTag({ latest: v.latest, processChanged: v.processChanged, legacyRevision: v.approvedHasVersion ? null : v.approvedRevNo }) : null;
  if (!label) return { label: status.label, tone: TONE[status.tone] };
  return { label, tone: v?.latest && v.processChanged ? 'warn' : v?.latest ? 'ok' : TONE[status.tone] };
}

export function ProcessWorkspace({ store: base, nav, processId, stage, onWorkspace }: { store: JourneyStore; nav: Nav; processId: string; stage: StageId; onWorkspace?: (workspaceId: string) => void }) {
  const [data, setData] = React.useState<Loaded | null | 'missing'>(null);
  const workspaceRef = React.useRef<string | null>(null);
  const store = React.useMemo(() => watchWrites(base, () => {
    const ws = workspaceRef.current;
    if (ws) base.versionStates(ws, processId).then(v => setData(d => (d && d !== 'missing' ? { ...d, versions: v[0] ?? null } : d))).catch(() => {});
  }), [base, processId]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [me, setMe] = React.useState('');
  // Who makes a choice here, by id and name (item 7 of package 10); the names show who made earlier ones.
  const [chooser, setChooser] = React.useState<Chooser>({ id: null, name: '', names: {} });
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
  const chooserWorkspace = data && data !== 'missing' ? data.process.workspaceId : null;
  React.useEffect(() => {
    if (!chooserWorkspace) return;
    Promise.all([store.currentUser().catch(() => null), store.listMembers(chooserWorkspace).catch(() => [])]).then(([u, mem]) => {
      const names = Object.fromEntries(mem.map(x => [x.userId, x.name]));
      const mine = u?.id ? names[u.id] : '';
      setChooser({ id: u?.id ?? null, name: mine && mine !== 'Unnamed member' ? mine : '', names });
    });
  }, [store, chooserWorkspace]);

  const load = React.useCallback(async () => {
    try {
      const process = await store.getProcess(processId);
      if (!process) { setData('missing'); return; }
      workspaceRef.current = process.workspaceId;
      const [revisions, workspaces, versions] = await Promise.all([store.listRevisions(processId), store.listWorkspaces(), store.versionStates(process.workspaceId, processId).catch(() => [])]);
      const current = revisions.find(r => r.state === 'working') ?? revisions.find(r => r.state === 'approved');
      const model = current ? await store.getModel(current.id) : null;
      setData({ process, workspace: workspaces.find(w => w.id === process.workspaceId) ?? null, revisions, model, versions: versions[0] ?? null });
    } catch (e) {
      setError(messageOf(e));
    }
  }, [store, processId]);
  React.useEffect(() => { load(); }, [load]);
  // Answers recorded from the Ask Avala panel show here at once.
  useProcessChanged(processId, load);
  // Before its questions are put to people, the sources are looked in for their answers (part D).
  const shown = data && data !== 'missing' ? data : null;
  // What was looked up in the sources is shared: read the server's copy for everyone, then look for editors.
  useSharedLook(store, shown?.process ?? null, Boolean(shown?.workspace && shown.workspace.role !== 'viewer'));
  useAutoLook(store, shown?.process ?? null, shown?.model ?? null, Boolean(shown?.workspace && shown.workspace.role !== 'viewer'));
  // A process opened by a link may belong to another workspace than the one the top bar shows: it follows.
  const processWorkspace = data && data !== 'missing' && data.workspace ? data.workspace.id : null;
  React.useEffect(() => { if (processWorkspace) onWorkspace?.(processWorkspace); }, [processWorkspace, onWorkspace]);
  // A link from the weekday email to questions (?gaps=all): Closing the gaps where this process answers them,
  // on Documents or, without that stage (the "Assess" set-up), on the Assessment stage (questionsLanding). Once,
  // and the marker leaves the address, so a reload opens the stage alone.
  const gapsAsked = React.useRef(typeof location !== 'undefined' && new URLSearchParams(location.search).get(GAPS_MARK.name) === GAPS_MARK.value);
  React.useEffect(() => {
    if (!gapsAsked.current || !shown) return;
    gapsAsked.current = false;
    const params = new URLSearchParams(location.search);
    params.delete(GAPS_MARK.name);
    const rest = params.toString();
    history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
    const landing = questionsLanding(stagesForProcess(shown.workspace?.modules, shown.model));
    if (landing.gaps) openGaps(processId, landing.gaps, 'all');
    if (landing.stage !== stage) nav.go({ page: 'process', processId, stage: landing.stage }, { replace: true });
  }, [shown, processId, stage, nav]);
  // On a narrow screen the stage rail scrolls sideways: keep the open stage in view.
  const loaded = Boolean(data && data !== 'missing');
  React.useEffect(() => {
    if (loaded) document.querySelector('nav[aria-label="Stages"] [aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [stage, loaded]);

  // Approving keeps the documents (package 14): built first, then confirmed with a reason from version 2 on.
  const [approving, setApproving] = React.useState<PreparedApproval | null>(null);
  const [approveError, setApproveError] = React.useState<string | null>(null);
  // The reason typed in the approval window outlives a refusal and the reload after it; it is cleared once approved.
  const [reason, setReason] = React.useState('');
  const startApproval = async (processId: string, workspaceId: string, mode: 'approve' | 'keep' = 'approve') => {
    setBusy(true); setError(null); setApproveError(null);
    try {
      const prepared = await prepareApproval(store, processId, workspaceId, mode);
      if (!prepared) { await load(); return; }
      if (prepared.number === 1) {
        // Keeping an earlier approval as version 1 asks once, saying whose approval it records (pull request 4).
        const a = prepared.approved;
        if (prepared.mode === 'keep' && a && !window.confirm(keepFirstQuestion(a.revNo, longDate(a.approvedAt), a.approverName ?? UNNAMED_APPROVER))) return;
        await approvePrepared(store, processId, prepared, null); await load(); return;
      }
      setApproving(prepared);
    } catch (e) { setError(notApproved(e)); await load(); } finally { setBusy(false); }
  };
  const confirmApproval = async (processId: string, reason: string) => {
    if (!approving) return;
    setBusy(true); setApproveError(null);
    try { await approvePrepared(store, processId, approving, reason); setApproving(null); setReason(''); await load(); }
    catch (e) {
      // Someone saved or approved meanwhile: the page reads everything again, and nothing was approved.
      if ((e as { status?: number }).status === 409) { setApproving(null); setError(notApproved(e)); await load(); }
      else setApproveError(messageOf(e));
    } finally { setBusy(false); }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };

  if (data === 'missing') {
    return <EmptyState title="Process not found" action={<Button variant="secondary" onClick={() => nav.go({ page: 'processes' })}>All processes</Button>}>It may have been removed, or you may not have access to its workspace.</EmptyState>;
  }
  if (!data) return error ? <ErrorNote message={error} /> : <Spinner />;

  const { process, workspace, revisions, model, versions } = data;
  const status = tagOf(revisions, versions);
  const working = revisions.find(r => r.state === 'working');
  const approved = revisions.find(r => r.state === 'approved');
  const current = working ?? approved;
  const canEdit = workspace !== null && workspace.role !== 'viewer';
  // Only the stages of the parts the organisation uses; a stage that is off says so (nothing is deleted).
  // And of those, the stages what the person wants from this process includes (domain/plan/purpose.ts).
  const shownStages = stagesForProcess(workspace?.modules, model);
  const purposeOff = stagesFor(workspace?.modules).includes(stage) ? purposeOffMessage(stage, model) : null;
  const stageOff = !shownStages.includes(stage);
  const approvedWithoutCopy = Boolean(versions?.approvedRevisionId && !versions.approvedHasVersion);
  const canApprove = offersApproval({ canApprove: Boolean(workspace?.canApprove), target: approvalTarget(revisions), latest: versions?.latest?.number ?? null, processChanged: Boolean(versions?.processChanged), workspaceChanges: versions?.workspaceChanges ?? [], approvedWithoutCopy });
  // "Keep it as it reads now" (part J): an approval from before copies were kept, kept with its own approver and date.
  const canKeep = offersKeep({ canApprove: Boolean(workspace?.canApprove), approvedRevisionId: versions?.approvedRevisionId ?? null, approvedHasVersion: Boolean(versions?.approvedHasVersion) });
  const hasSteps = Boolean(model && model.steps.length > 0);

  return (
    <div>
      {/* The page head of the main pages (PageHead): a quiet line above, the name in navy. */}
      <nav aria-label="Breadcrumb" className="text-[13px] font-medium text-slate-500">
        <a href={nav.href({ page: 'processes' })} className="hover:text-slate-800" onClick={e => { e.preventDefault(); nav.go({ page: 'processes' }); }}>Processes</a>
        <span className="mx-2 text-slate-300" aria-hidden>/</span>
        <span className="text-slate-700">{process.name}</span>
      </nav>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 break-words font-display text-3xl font-semibold tracking-tight text-[#002C4B] sm:text-4xl">{process.name}</h1>
          <Tag data-testid="revision-status" tone={status.tone} className="px-2 py-1 text-xs">{status.label}</Tag>
          {/* What is wanted from the process, on every page of it, when it is not "Assess it and document it": it says why Assessment is missing. */}
          {model && purposeTag(purposeOf(model), model.meta.decidedApproach) && <Tag tone="info" data-testid="purpose-tag" className="px-2 py-1 text-xs">{purposeTag(purposeOf(model), model.meta.decidedApproach)}</Tag>}
        </div>
        <div className="flex items-center gap-2">
          {canApprove && model && typicalCounts(model).total > 0 && (
            <Tag tone="warn" data-testid="typical-unconfirmed" title="Approving keeps them marked Typical, not confirmed, in the approved documents">{typicalCounts(model).total} typical {typicalCounts(model).total === 1 ? 'item' : 'items'} not confirmed</Tag>
          )}
          {canApprove && (
            <Button variant="secondary" disabled={busy} data-testid="approve" onClick={() => {
              // An approved version is never changed, so approving what nobody has confirmed is asked about first.
              const n = model ? typicalCounts(model).total : 0;
              if (n > 0 && !window.confirm(`${n} typical ${n === 1 ? 'item has' : 'items have'} not been confirmed by your people. Approving keeps ${n === 1 ? 'it' : 'them'} marked "Typical, not confirmed" in the approved documents, and an approved version cannot be changed. Approve anyway?`)) return;
              startApproval(process.id, process.workspaceId);
            }}>{busy && !approving ? 'Keeping the documents…' : 'Approve'}</Button>
          )}
          {canKeep && (
            <Button variant="secondary" disabled={busy} data-testid="keep-as-reads" onClick={() => startApproval(process.id, process.workspaceId, 'keep')}>Keep it as it reads now</Button>
          )}
          <Button variant="ghost" onClick={() => setHistoryOpen(true)} aria-haspopup="dialog">History</Button>
        </div>
      </div>

      <ProcessPeople store={store} workspaceId={process.workspaceId} processId={process.id} canEdit={canEdit}
        named={{ analystId: process.analystId ?? null, architectId: process.architectId ?? null, approverId: process.approverId ?? null }} onError={setError} />

      {/* The journey: six stages in order. A tick means the stage has what the next ones need;
          a stage that is still waiting for the process steps is shown quieter, and can still be opened. */}
      <nav aria-label="Stages" className="mt-5">
        <ol className="flex overflow-x-auto rounded-xl border border-slate-200 bg-white px-1.5">
          {STAGES.filter(s => shownStages.includes(s.id)).map((s, i) => {
            const here = s.id === stage;
            const done = s.id === 'sources' ? sources.length > 0 : s.id === 'process' ? hasSteps : false;
            const waiting = !done && !here && s.id !== 'sources' && (s.id === 'process' ? false : !hasSteps);
            return (
              <li key={s.id} className="flex items-center">
                {i > 0 && <svg viewBox="0 0 8 12" className="mx-0.5 h-3 w-2 shrink-0 text-slate-300" aria-hidden><path d="m1.5 1.5 4.5 4.5-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                <a
                  href={nav.href({ page: 'process', processId: process.id, stage: s.id })}
                  aria-current={here ? 'page' : undefined}
                  title={waiting ? 'Needs the process steps first' : undefined}
                  onClick={e => { e.preventDefault(); nav.go({ page: 'process', processId: process.id, stage: s.id }); }}
                  className={cx('flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition-colors',
                    here ? 'border-[#FFBC03] text-[#002C4B]' : cx('border-transparent hover:text-slate-900', waiting ? 'text-slate-500' : 'text-slate-600'))}
                >
                  <span aria-hidden data-n={i + 1} className={cx('flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums', !(done && !here) && 'before:content-[attr(data-n)]',
                    here ? 'bg-[#002C4B] text-white' : done ? 'bg-emerald-600 text-white' : waiting ? 'bg-slate-100 text-slate-600' : 'bg-slate-200 text-slate-700')}>
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
        {stageOff && purposeOff ? <EmptyState title="Documented as it is" action={<Button variant="secondary" onClick={() => nav.go({ page: 'process', processId: process.id, stage: 'process' })}>Open the brief</Button>}><span data-testid="purpose-off">{purposeOff}</span></EmptyState> :
         stageOff ? <EmptyState title="Not switched on">{offMessage(shownStages.length ? stage : 'processes', workspace?.organizationName ?? '')}</EmptyState> :
        <SourceContext.Provider value={sourceCtx}><ChooserContext.Provider value={chooser}>
        {stage === 'sources'
          ? <SourcesStage store={store} processId={process.id} workspaceId={process.workspaceId} canEdit={canEdit} me={me} processName={process.name} hasSteps={hasSteps} asksInMind={whatFollows(model).asksInMind} onModelChanged={load} onSourcesChanged={loadSources} goToProcess={() => nav.go({ page: 'process', processId: process.id, stage: 'process' })} />
          : stage === 'assessment' && model && current
          ? <AssessmentStage store={store} processId={process.id} workspaceId={process.workspaceId} model={model} working={working ? { id: working.id, seq: working.seq } : null}
              revisionId={current.id} canEdit={canEdit} me={me} sources={sources} onSaved={load} onSourcesChanged={loadSources} documents={shownStages.includes('documents')} />
          : stage === 'documents' && model && current && model.steps.length > 0
          ? <DocumentsStage store={store} processId={process.id} workspaceId={process.workspaceId} model={model} sources={sources} canEdit={canEdit} working={working ? { id: working.id, seq: working.seq } : null} onSaved={load} me={me} onSourcesChanged={loadSources} approvedRevision={approved ? approved.revNo : null} approvedRevisionId={approved && current.state === 'working' ? approved.id : null} currentRevisionId={current.id} versionState={versions} onFix={() => nav.go({ page: 'process', processId: process.id, stage: 'process' })}
              revision={{ label: `Revision ${current.revNo}${current.state === 'working' ? ', working draft' : ''}`, state: current.state === 'approved' ? 'approved' : 'working', date: new Date(current.approvedAt ?? current.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) }} />
          : stage === 'work-items' && model && model.steps.length > 0
          ? <WorkItemsStage store={store} processId={process.id} workspaceId={process.workspaceId} model={model} canEdit={canEdit} onOpenBoard={id => nav.go({ page: 'board', projectId: id })} />
          : stage === 'flows' && model && model.steps.length > 0
          ? <FlowsStage store={store} processId={process.id} workspaceId={process.workspaceId} model={model} working={working ? { id: working.id, seq: working.seq } : null} revisionId={current?.id ?? ''} canEdit={canEdit} me={me} onSaved={load} />
          : stage === 'process' && model
          ? <ProcessStage store={store} processId={process.id} workspaceId={process.workspaceId} model={model} working={working ? { id: working.id, seq: working.seq } : null} canEdit={canEdit} me={me} onSaved={load} processName={process.name} askPurpose={offersPurpose(workspace?.modules)} />
          : <StagePanel stage={stage} model={model} canEdit={canEdit} busy={busy} onStart={() => act(() => store.startDraft(process.id))} onGo={id => nav.go({ page: 'process', processId: process.id, stage: id })} />}
        </ChooserContext.Provider></SourceContext.Provider>}
      </section>

      {approving && <ApproveDialog prepared={approving} busy={busy} error={approveError} reason={reason} onReason={setReason} onApprove={r => confirmApproval(process.id, r)} onClose={() => { setApproving(null); setApproveError(null); }} />}
      {historyOpen && <HistoryDrawer store={store} processId={process.id} workspaceId={process.workspaceId} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

function ProcessStage({ store, processId, workspaceId, model, working, canEdit, me, onSaved, processName, askPurpose }: {
  store: JourneyStore; processId: string; workspaceId: string; model: ProcessModel; working: { id: string; seq: number } | null; canEdit: boolean; me: string; onSaved: () => void; processName: string;
  /** Whether to ask what is wanted from the process: only an organisation that uses the documents is asked. */
  askPurpose: boolean;
}) {
  const editor = useModelEditor(store, processId, { model, working }, onSaved);
  const { title } = React.useContext(SourceContext);
  const impact = useImpactContext(store, processId, workspaceId);
  // Who answered what is wanted from the process is shown by name, never by email address.
  const [people, setPeople] = React.useState<{ meId: string | null; names: Record<string, string> }>({ meId: null, names: {} });
  // A switch of the answer works the requirements out again and saves them at once, so nothing that reads
  // the stored list sees one from the other answer (domain/requirements/switch.ts). If that cannot be saved
  // now, the answer still stands and Documents brings them up to date when it opens; nothing is lost.
  const onSwitched = React.useCallback(async (before: ProcessModel, after: ProcessModel): Promise<string | null> => {
    try {
      await followSwitch(store, processId, before, after);
      return null;
    } catch {
      return 'Your answer is saved. The requirements could not be brought up to date just now; they will be when Documents is opened.';
    }
  }, [store, processId]);
  React.useEffect(() => {
    if (!askPurpose) return;
    Promise.all([store.currentUser().catch(() => null), store.listMembers(workspaceId).catch(() => [])])
      .then(([u, mem]) => setPeople({ meId: u?.id ?? null, names: Object.fromEntries(mem.map(x => [x.userId, x.name])) }));
  }, [store, workspaceId, askPurpose]);
  const [apps, setApps] = React.useState<Application[] | null>(null);
  React.useEffect(() => { store.listApplications(workspaceId).then(setApps).catch(() => setApps(null)); }, [store, workspaceId]);
  const appList = React.useMemo<AppList | null>(() => (apps ? {
    apps,
    add: async input => { const saved = await store.saveApplication(workspaceId, input); setApps(cur => [...(cur ?? []), saved]); },
  } : null), [apps, store, workspaceId]);
  // The brief, read from the sources on request (part A): the reading task in journey-ai, then by rule.
  const [reading, setReading] = React.useState(false);
  const [readError, setReadError] = React.useState<string | null>(null);
  // "Make it a requirement" on what a person wants to change (package B, 5b): the register of this process.
  const wantedRequirements = React.useMemo(() => ({ list: () => store.listRequirements(processId), save: (rows: Parameters<typeof store.saveRequirements>[1]) => store.saveRequirements(processId, rows) }), [store, processId]);
  const readBriefNow = async () => {
    setReading(true); setReadError(null);
    try {
      const rows = (await store.listSources(processId)).filter(s => !s.archived);
      const sources = await Promise.all(rows.map(async s => ({ key: s.key, title: s.title, segments: await store.getSourceSegments(s.id).catch(() => []) })));
      const { segments, ingest } = briefSegments(editor.model, sources);
      if (!segments.length) { setReadError('There are no sources to read the brief from yet.'); return; }
      const r = await store.runAiTask(workspaceId, readBrief.id, segments as never);
      const read = briefFromFindings(((r.data as { findings?: BriefFinding[] } | null)?.findings ?? []), ingest, editor.model);
      await editor.apply(m => adoptBrief(m, read), 'Brief read from the sources');
    } catch (e) { setReadError(messageOf(e)); } finally { setReading(false); }
  };
  return (
    <>
      <ErrorNote message={readError} />
      <BriefPanel editor={editor} canEdit={canEdit} sourceTitle={title} reading={reading} onRead={canEdit && store.aiAvailable ? readBriefNow : undefined} purpose={askPurpose ? { ...people, onSwitched } : undefined}
        requirements={wantedRequirements} />
      <TypicalPanel editor={editor} canEdit={canEdit} />
      <ProcessEditor processId={processId} editor={editor} canEdit={canEdit} me={me} sourceTitle={title} impact={impact} appList={appList} />
    </>
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
  const open = openItemsNow(model);
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
