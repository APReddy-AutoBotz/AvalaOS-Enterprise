// "Ask Avala" in the top bar, on every page (docs/product-plan.md, "Ask Avala: the plan", stage 1). The
// panel says what it is asking about: on a process page, that process; elsewhere the person picks one of
// the workspace's processes (domain/assistant/scope.ts). The board and the whole workspace come next in
// the plan as scopes of their own. The answering itself is journey/process/AskPanel.tsx, unchanged.
import React from 'react';
import type { JourneyStore, ProcessRow, SourceRow, Workspace } from './store/types.ts';
import type { ProcessModel } from '../domain/processModel/types.ts';
import type { Target } from '../domain/assistant/ask.ts';
import { askable, askScope } from '../domain/assistant/scope.ts';
import { stagesFor } from '../domain/workspace/modules.ts';
import type { Nav } from './JourneyApp.tsx';
import { AskPanel } from './process/AskPanel.tsx';
import { SidePanel } from './process/widgets.tsx';
import { AskAvalaButton, ErrorNote, messageOf, Spinner } from './ui.tsx';

interface Loaded { process: ProcessRow; model: ProcessModel | null; sources: SourceRow[] }

/** The process's current model (the working draft, else the approved revision) and its sources, as the process page reads them. */
async function loadForAsk(store: JourneyStore, processId: string): Promise<Loaded | null> {
  const process = await store.getProcess(processId);
  if (!process) return null;
  const [revisions, sources] = await Promise.all([store.listRevisions(processId), store.listSources(processId)]);
  const current = revisions.find(r => r.state === 'working') ?? revisions.find(r => r.state === 'approved');
  return { process, model: current ? await store.getModel(current.id) : null, sources };
}

export function AskAvala({ store, nav, workspace }: { store: JourneyStore; nav: Nav; workspace: Workspace }) {
  const stages = stagesFor(workspace.modules);
  const [open, setOpen] = React.useState(false);
  // Asking is about processes, so a workspace whose organisation uses only the board has no button yet.
  if (!stages.length) return null;
  return (
    <>
      <AskAvalaButton compact onClick={() => setOpen(true)} aria-haspopup="dialog" />
      {open && <AskHost store={store} nav={nav} workspace={workspace} stages={stages} onClose={() => setOpen(false)} />}
    </>
  );
}

function AskHost({ store, nav, workspace, stages, onClose }: {
  store: JourneyStore; nav: Nav; workspace: Workspace; stages: ReturnType<typeof stagesFor>; onClose: () => void;
}) {
  const [picked, setPicked] = React.useState<string | null>(null);
  const scope = askScope(nav.route, picked);
  const processId = scope.kind === 'process' ? scope.processId : null;
  const [processes, setProcesses] = React.useState<ProcessRow[] | null>(null);
  const [loaded, setLoaded] = React.useState<Loaded | null | 'missing'>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    store.listProcesses(workspace.id).then(p => { if (live) setProcesses(p); }).catch(e => { if (live) setError(messageOf(e)); });
    return () => { live = false; };
  }, [store, workspace.id]);
  React.useEffect(() => {
    let live = true;
    setLoaded(null);
    if (processId) loadForAsk(store, processId).then(r => { if (live) setLoaded(r ?? 'missing'); }).catch(e => { if (live) setError(messageOf(e)); });
    return () => { live = false; };
  }, [store, processId]);

  // A citation leads to where its fact lives; the panel closes so the page is in view.
  const onOpen = (t: Target) => {
    if (!processId) return;
    onClose();
    if (t.kind === 'item') nav.go({ page: 'board', projectId: t.projectId, itemId: t.itemId });
    else if (t.kind === 'platform') nav.go({ page: 'process', processId, stage: stages.includes(t.stage) ? t.stage : 'process' });
    else nav.go({ page: 'process', processId, stage: t.kind === 'assessment' ? 'assessment' : t.kind === 'requirement' && stages.includes('documents') ? 'documents' : 'process' });
  };

  // A process that is open on a page but not of this workspace (opened by a link) is still offered.
  const options = processes && loaded && loaded !== 'missing' && !processes.some(p => p.id === loaded.process.id) ? [...processes, loaded.process] : processes ?? [];
  const about = (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
      <label htmlFor="ask-about" className="text-sm text-slate-600">Asking about</label>
      <select id="ask-about" value={processId ?? ''} onChange={e => setPicked(e.target.value || null)} disabled={!processes}
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-900 focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20">
        {!processId && <option value="">Choose a process</option>}
        {options.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  );

  if (processId && loaded && loaded !== 'missing' && askable(loaded.model)) {
    return (
      <React.Fragment key={processId}>
        <AskPanel store={store} processId={processId} workspaceId={loaded.process.workspaceId} model={loaded.model!} sources={loaded.sources} about={about} onOpen={onOpen} onClose={onClose} />
      </React.Fragment>
    );
  }
  return (
    <SidePanel title="Ask Avala" onClose={onClose} wide>
      <div data-testid="ask-panel">
        {about}
        <ErrorNote message={error} />
        {!processId && processes && processes.length > 0 && <p className="text-sm leading-6 text-slate-600">Choose a process to ask about. Answers come only from its record and from how Avala OS works, and each sentence links to where it came from.</p>}
        {!processId && processes && processes.length === 0 && <p className="text-sm leading-6 text-slate-600">This workspace has no processes yet. Add one on the Processes page, then ask about it here.</p>}
        {processId && loaded === 'missing' && <p className="text-sm leading-6 text-slate-600">That process is not in your workspaces.</p>}
        {processId && loaded && loaded !== 'missing' && !askable(loaded.model) && <p className="text-sm leading-6 text-slate-600">{loaded.process.name} has no steps yet, so its record holds nothing to answer from. Add its sources and read them into the process first.</p>}
        {((processId && loaded === null) || (!processId && !processes)) && !error && <div className="mt-4"><Spinner /></div>}
      </div>
    </SidePanel>
  );
}
