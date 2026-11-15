// "Ask Avala" in the top bar, on every page (docs/product-plan.md, "Ask Avala: the plan", stage 1). The
// panel says what it is asking about: on a process page, that process; on the Delivery board, that board;
// elsewhere the whole workspace (domain/assistant/scope.ts). The person can pick another process or board,
// or widen to the whole workspace. The answering itself is journey/process/AskPanel.tsx, the same for all.
import React from 'react';
import type { JourneyStore, ProcessRow, SourceRow, Workspace } from './store/types.ts';
import type { Project } from '../domain/workitems/board.ts';
import type { ProcessModel } from '../domain/processModel/types.ts';
import type { Target } from '../domain/assistant/ask.ts';
import { askable, askScope, pickOf } from '../domain/assistant/scope.ts';
import { navFor, stagesFor } from '../domain/workspace/modules.ts';
import type { Nav } from './JourneyApp.tsx';
import { AskPanel } from './process/AskPanel.tsx';
import { boardSubject, processSubject, workspaceSubject } from './process/askSubjects.ts';
import { InterviewPanel } from './process/InterviewPanel.tsx';
import { SuggestionsPanel } from './process/SuggestionsPanel.tsx';
import type { Suggestion } from '../domain/assistant/suggest.ts';
import { useProcessChanged } from './processChanged.ts';
import { assessProcess } from '../domain/assess/process.ts';
import { triage } from '../domain/questions/triage.ts';
import { interviewQueue } from '../domain/questions/interview.ts';
import { SidePanel } from './process/widgets.tsx';
import { AskAvalaButton, ErrorNote, messageOf, Spinner } from './ui.tsx';

interface LoadedProcess { process: ProcessRow; model: ProcessModel | null; sources: SourceRow[]; working: { id: string; seq: number } | null }

/** The process's current model (the working draft, else the approved revision) and its sources, as the process page reads them. */
async function loadProcess(store: JourneyStore, processId: string): Promise<LoadedProcess | null> {
  const process = await store.getProcess(processId);
  if (!process) return null;
  const [revisions, sources] = await Promise.all([store.listRevisions(processId), store.listSources(processId)]);
  const current = revisions.find(r => r.state === 'working') ?? revisions.find(r => r.state === 'approved');
  const draft = revisions.find(r => r.state === 'working');
  return { process, model: current ? await store.getModel(current.id) : null, sources, working: draft ? { id: draft.id, seq: draft.seq } : null };
}

export function AskAvala({ store, nav, workspace }: { store: JourneyStore; nav: Nav; workspace: Workspace }) {
  const stages = stagesFor(workspace.modules);
  const boards = navFor(workspace).board;
  const [open, setOpen] = React.useState(false);
  // Nothing to ask about where the organisation uses neither processes nor the board.
  if (!stages.length && !boards) return null;
  return (
    <>
      <AskAvalaButton compact onClick={() => setOpen(true)} aria-haspopup="dialog" />
      {open && <AskHost store={store} nav={nav} workspace={workspace} stages={stages} boards={boards} onClose={() => setOpen(false)} />}
    </>
  );
}

function AskHost({ store, nav, workspace, stages, boards, onClose }: {
  store: JourneyStore; nav: Nav; workspace: Workspace; stages: ReturnType<typeof stagesFor>; boards: boolean; onClose: () => void;
}) {
  const [picked, setPicked] = React.useState<string | null>(null);
  const [processes, setProcesses] = React.useState<ProcessRow[] | null>(null);
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  const [loaded, setLoaded] = React.useState<LoadedProcess | null | 'missing'>(null);
  const [error, setError] = React.useState<string | null>(null);
  // On a process: asking questions, or the interview through its open questions (stage 2).
  const [view, setView] = React.useState<'ask' | 'interview' | 'suggestions'>('ask');
  // A suggested answer opens the interview on its question, filled in.
  const [start, setStart] = React.useState<Extract<Suggestion['target'], { kind: 'answer' }> | null>(null);

  React.useEffect(() => {
    let live = true;
    Promise.all([stages.length ? store.listProcesses(workspace.id) : Promise.resolve([]), boards ? store.listProjects(workspace.id) : Promise.resolve([])])
      .then(([p, b]) => { if (live) { setProcesses(p); setProjects(b); } }).catch(e => { if (live) setError(messageOf(e)); });
    return () => { live = false; };
  }, [store, workspace.id, stages.length, boards]);

  // The board page without a project shows the first one; so does asking about it.
  let scope = askScope(nav.route, picked);
  if (scope.kind === 'board' && !scope.projectId && projects?.[0]) scope = { kind: 'board', projectId: projects[0].id };
  if ((scope.kind === 'process' && !stages.length) || (scope.kind === 'board' && !boards)) scope = { kind: 'workspace' };
  const processId = scope.kind === 'process' ? scope.processId : null;
  const projectId = scope.kind === 'board' ? scope.projectId : null;
  const project = projectId ? projects?.find(p => p.id === projectId) ?? null : null;

  // Read again when an answer is recorded (from the interview here, or the page), quietly: the panel stays.
  const [version, setVersion] = React.useState(0);
  useProcessChanged(processId ?? '', React.useCallback(() => setVersion(v => v + 1), []));
  React.useEffect(() => {
    let live = true;
    if (version === 0) setLoaded(null);
    if (processId) loadProcess(store, processId).then(r => { if (live) setLoaded(r ?? 'missing'); }).catch(e => { if (live) setError(messageOf(e)); });
    return () => { live = false; };
  }, [store, processId, version]);

  const whole = scope.kind === 'workspace';
  const subject = React.useMemo(() => {
    if (whole) return { workspaceId: workspace.id, subject: workspaceSubject(store, { workspace: { id: workspace.id, name: workspace.name }, processesInUse: stages.length > 0, boardsInUse: boards }) };
    if (project) return { workspaceId: workspace.id, subject: boardSubject(store, { workspaceId: workspace.id, project: { id: project.id, name: project.name } }) };
    if (processId && loaded && loaded !== 'missing' && askable(loaded.model)) {
      const workspaceId = loaded.process.workspaceId;
      return { workspaceId, subject: processSubject(store, { processId, workspaceId, model: loaded.model!, sources: loaded.sources }) };
    }
    return null;
  }, [store, workspace.id, workspace.name, whole, stages.length, boards, project, processId, loaded]);

  // A citation leads to where its fact lives; the panel closes so the page is in view.
  const onOpen = (t: Target, inProcess: string | null = processId) => {
    onClose();
    if (t.kind === 'within') { onOpen(t.target, t.processId); return; }
    if (t.kind === 'open-process') nav.go({ page: 'process', processId: t.processId, stage: 'process' });
    else if (t.kind === 'applications' || t.kind === 'people') nav.go({ page: 'settings', section: t.kind });
    else if (t.kind === 'portfolio') nav.go({ page: 'processes' });
    else if (t.kind === 'item') nav.go({ page: 'board', projectId: t.projectId, itemId: t.itemId });
    else if (t.kind === 'board') nav.go({ page: 'board', projectId: t.projectId });
    else if (!inProcess) { if (t.kind === 'platform' && projectId) nav.go({ page: 'board', projectId }); }
    else if (t.kind === 'platform') nav.go({ page: 'process', processId: inProcess, stage: stages.includes(t.stage) ? t.stage : 'process' });
    else nav.go({ page: 'process', processId: inProcess, stage: t.kind === 'assessment' ? 'assessment' : t.kind === 'requirement' && stages.includes('documents') ? 'documents' : 'process' });
  };

  // A process open on a page but not of this workspace (opened by a link) is still offered.
  const processOptions = processes && loaded && loaded !== 'missing' && !processes.some(p => p.id === loaded.process.id) ? [...processes, loaded.process] : processes ?? [];
  const about = (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
      <label htmlFor="ask-about" className="text-sm text-slate-600">Asking about</label>
      <select id="ask-about" value={pickOf(scope)} onChange={e => setPicked(e.target.value || null)} disabled={!processes || !projects}
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-900 focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20">
        {!pickOf(scope) && <option value="">Choose a board</option>}
        <option value="w">The whole workspace</option>
        {processOptions.length > 0 && <optgroup label="Processes">{processOptions.map(p => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup>}
        {(projects ?? []).length > 0 && <optgroup label="Delivery board">{projects!.map(p => <option key={p.id} value={`b:${p.id}`}>{p.name}</option>)}</optgroup>}
      </select>
    </div>
  );

  // The interview's tab, with how many open questions wait, on a process that has steps.
  const proc = processId && loaded && loaded !== 'missing' && askable(loaded.model) ? loaded : null;
  const openCount = proc ? interviewQueue(triage(proc.model!, assessProcess(proc.model!))).length : 0;
  const tabs = proc && (
    <div role="tablist" aria-label="Ask Avala" className="mb-4 flex gap-1 border-b border-slate-200">
      {(['ask', 'interview', 'suggestions'] as const).map(v => (
        <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => { setStart(null); setView(v); }}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${view === v ? 'border-[#E69F00] text-[#002C4B]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {v === 'ask' ? 'Ask' : v === 'interview' ? `Open questions${openCount ? ` (${openCount})` : ''}` : 'Suggestions'}
        </button>
      ))}
    </div>
  );
  if (proc && view === 'interview') {
    return (
      <SidePanel title="Ask Avala" onClose={onClose} wide>
        <div data-testid="ask-panel">
          {about}{tabs}
          <React.Fragment key={`${proc.process.id}:${start?.itemKey ?? ''}`}>
            <InterviewPanel store={store} process={proc.process} workspace={workspace} model={proc.model!} working={proc.working} start={start} />
          </React.Fragment>
        </div>
      </SidePanel>
    );
  }
  if (proc && view === 'suggestions') {
    // "Review and apply": an answer opens the interview on it; anything else, the stage where it is made.
    const review = (sg: Suggestion) => {
      if (sg.target.kind === 'answer') { setStart(sg.target); setView('interview'); return; }
      onClose();
      nav.go({ page: 'process', processId: proc.process.id, stage: stages.includes(sg.target.stage) ? sg.target.stage : 'process' });
    };
    return (
      <SidePanel title="Ask Avala" onClose={onClose} wide>
        <div data-testid="ask-panel">
          {about}{tabs}
          <React.Fragment key={proc.process.id}>
            <SuggestionsPanel store={store} process={proc.process} workspace={workspace} model={proc.model!} onReview={review} />
          </React.Fragment>
        </div>
      </SidePanel>
    );
  }
  if (subject) {
    return (
      <React.Fragment key={pickOf(scope)}>
        <AskPanel store={store} workspaceId={subject.workspaceId} subject={subject.subject} about={<>{about}{tabs}</>} stages={stages} onOpen={onOpen} onClose={onClose} />
      </React.Fragment>
    );
  }
  const lists = Boolean(processes && projects);
  return (
    <SidePanel title="Ask Avala" onClose={onClose} wide>
      <div data-testid="ask-panel">
        {about}
        <ErrorNote message={error} />
        {scope.kind === 'board' && lists && !project && (projectId ? <p className="text-sm leading-6 text-slate-600">That board is not in this workspace.</p> : null)}
        {processId && loaded === 'missing' && <p className="text-sm leading-6 text-slate-600">That process is not in your workspaces.</p>}
        {processId && loaded && loaded !== 'missing' && !askable(loaded.model) && <p className="text-sm leading-6 text-slate-600">{loaded.process.name} has no steps yet, so its record holds nothing to answer from. Add its sources and read them into the process first.</p>}
        {((processId && loaded === null) || !lists) && !error && <div className="mt-4"><Spinner /></div>}
      </div>
    </SidePanel>
  );
}
