import React from 'react';
import type { JourneyStore, ProcessRow, Workspace } from '../store/types.ts';
import type { Nav } from '../JourneyApp.tsx';
import { Button, cx, EmptyState, ErrorNote, Field, messageOf, Spinner, when } from '../ui.tsx';
import { Portfolio } from './Portfolio.tsx';
import { WorkspaceSettings } from './WorkspaceSettings.tsx';

const WORKSPACE_KEY = 'avala.journey.workspace';
const remembered = () => { try { return localStorage.getItem(WORKSPACE_KEY); } catch { return null; } };
const remember = (id: string) => { try { localStorage.setItem(WORKSPACE_KEY, id); } catch { /* storage unavailable */ } };

export function ProcessesPage({ store, nav }: { store: JourneyStore; nav: Nav }) {
  const [workspaces, setWorkspaces] = React.useState<Workspace[] | null>(null);
  const [workspaceId, setWorkspaceId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const loadWorkspaces = React.useCallback(async () => {
    try {
      const list = await store.listWorkspaces();
      setWorkspaces(list);
      const pick = list.find(w => w.id === remembered()) ?? list[0];
      setWorkspaceId(pick?.id ?? null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [store]);
  React.useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);

  if (error) return <ErrorNote message={error} />;
  if (!workspaces) return <Spinner />;
  if (workspaces.length === 0) return <FirstRun store={store} onCreated={loadWorkspaces} />;
  const workspace = workspaces.find(w => w.id === workspaceId)!;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">{workspace.organizationName}</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Processes</h1>
        </div>
        {workspaces.length > 1 && (
          <label className="text-sm text-slate-600">
            <span className="mr-2">Workspace</span>
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={workspace.id}
              onChange={e => { setWorkspaceId(e.target.value); remember(e.target.value); }}
            >
              {workspaces.map(w => <option key={w.id} value={w.id}>{w.organizationName} · {w.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <React.Fragment key={workspace.id}><ProcessList store={store} nav={nav} workspace={workspace} /></React.Fragment>
    </div>
  );
}

function ProcessList({ store, nav, workspace }: { store: JourneyStore; nav: Nav; workspace: Workspace }) {
  const [processes, setProcesses] = React.useState<ProcessRow[] | null>(null);
  const [name, setName] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [view, setView] = React.useState<'list' | 'portfolio' | 'settings'>('list');
  const canEdit = workspace.role !== 'viewer';

  React.useEffect(() => {
    store.listProcesses(workspace.id).then(setProcesses).catch(e => setError(messageOf(e)));
  }, [store, workspace.id]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await store.createProcess(workspace.id, name);
      nav.go({ page: 'process', processId: p.id, stage: 'sources' });
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  const addForm = (
    <form onSubmit={create} className="flex w-full max-w-xl flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1"><Field label="Process name" placeholder="e.g. Vendor invoice processing" required maxLength={200} value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
      <Button type="submit" disabled={busy || !name.trim()}>Add process</Button>
    </form>
  );

  return (
    <section className="mt-6 space-y-4">
      <ErrorNote message={error} />
      {processes !== null && (
        <div role="tablist" aria-label="Views" className="inline-flex rounded-xl bg-slate-100 p-1">
          {([['list', 'Processes'], ['portfolio', 'Portfolio'], ['settings', 'Settings']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
              className={cx('rounded-lg px-4 py-1.5 text-sm font-semibold transition', view === id ? 'bg-white text-[#002C4B] shadow-sm' : 'text-slate-600 hover:text-slate-900')}>{label}</button>
          ))}
        </div>
      )}
      {view === 'settings' && processes !== null ? <WorkspaceSettings store={store} workspace={workspace} /> : processes === null ? <Spinner /> : processes.length === 0 ? (
        <EmptyState title="No processes yet" action={canEdit ? addForm : undefined}>
          {canEdit ? 'Add the process you want to assess. You will add its transcripts, procedures and flowcharts next.' : 'Nobody has added a process to this workspace yet.'}
        </EmptyState>
      ) : (
        <>
          {view === 'portfolio' ? <Portfolio store={store} nav={nav} processes={processes} workspaceId={workspace.id} /> : <>
          {canEdit && (adding ? <div className="rounded-xl border border-slate-200 bg-white p-4">{addForm}</div> : <Button variant="secondary" onClick={() => setAdding(true)}>Add process</Button>)}
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {processes.map(p => (
              <li key={p.id}>
                <a
                  href={`/process/${p.id}/sources`}
                  onClick={e => { e.preventDefault(); nav.go({ page: 'process', processId: p.id, stage: 'sources' }); }}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-900">{p.name}</span>
                  <span className="text-xs text-slate-500">Updated {when(p.updatedAt)}</span>
                </a>
              </li>
            ))}
          </ul>
          </>}
        </>
      )}
    </section>
  );
}

function FirstRun({ store, onCreated }: { store: JourneyStore; onCreated: () => void }) {
  const [org, setOrg] = React.useState('');
  const [ws, setWs] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { workspaceId } = await store.createOrganization(org.trim(), ws.trim() || 'General');
      remember(workspaceId);
      onCreated();
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto mt-6 max-w-md">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Set up your organization</h1>
      <p className="mt-1 text-sm text-slate-600">You are not a member of any workspace yet. Create one, or ask a colleague to add you to theirs.</p>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <Field label="Organization" required value={org} onChange={e => setOrg(e.target.value)} />
        <Field label="First workspace" placeholder="General" hint="A team or department, for example Finance Operations." value={ws} onChange={e => setWs(e.target.value)} />
        <ErrorNote message={error} />
        <Button type="submit" className="w-full" disabled={busy || !org.trim()}>Create organization</Button>
      </form>
    </div>
  );
}
