import React from 'react';
import type { JourneyStore, ProcessRow, Workspace } from '../store/types.ts';
import type { Nav } from '../JourneyApp.tsx';
import { ago, Button, cx, EmptyState, ErrorNote, Field, messageOf, Spinner, Tag, when } from '../ui.tsx';
import { revisionStatus } from '../../domain/workspace/route.ts';

const STATUS_TONE = { neutral: 'neutral', draft: 'info', approved: 'ok', changed: 'warn' } as const;
import { Portfolio } from './Portfolio.tsx';
import { has, offMessage } from '../../domain/workspace/modules.ts';
import { remember } from '../workspaceChoice.ts';

/** The processes of the workspace the person is in: the list, and the portfolio that compares them. */
export function ProcessesPage({ store, nav, workspace }: { store: JourneyStore; nav: Nav; workspace: Workspace }) {
  return (
    <div>
      <p className="text-sm text-slate-500">{workspace.organizationName} · {workspace.name}</p>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Processes</h1>
      {has(workspace.modules, 'assess')
        ? <ProcessList store={store} nav={nav} workspace={workspace} />
        : <div className="mt-6"><EmptyState title="Not switched on">{offMessage('processes', workspace.organizationName)}</EmptyState></div>}
    </div>
  );
}

function ProcessList({ store, nav, workspace }: { store: JourneyStore; nav: Nav; workspace: Workspace }) {
  const [processes, setProcesses] = React.useState<ProcessRow[] | null>(null);
  const [name, setName] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [view, setView] = React.useState<'list' | 'portfolio'>('list');
  const canEdit = workspace.role !== 'viewer';

  const [status, setStatus] = React.useState<Record<string, ReturnType<typeof revisionStatus>>>({});
  React.useEffect(() => {
    store.listProcesses(workspace.id).then(list => {
      setProcesses(list);
      // Where each process stands (not started, working draft, approved), read after the list shows.
      list.forEach(p => store.listRevisions(p.id).then(r => setStatus(cur => ({ ...cur, [p.id]: revisionStatus(r) }))).catch(() => {}));
    }).catch(e => setError(messageOf(e)));
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Views" className="inline-flex rounded-lg bg-slate-200/70 p-0.5">
            {([['list', 'List'], ['portfolio', 'Portfolio']] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
                className={cx('rounded-md px-3.5 py-1.5 text-sm font-semibold transition', view === id ? 'bg-white text-[#002C4B] shadow-sm' : 'text-slate-600 hover:text-slate-900')}>{label}</button>
            ))}
          </div>
          {canEdit && view === 'list' && processes.length > 0 && !adding && <Button onClick={() => setAdding(true)}>Add process</Button>}
        </div>
      )}
      {processes === null ? <Spinner /> : processes.length === 0 ? (
        <EmptyState title="No processes yet" action={canEdit ? addForm : undefined}>
          {canEdit ? 'Add the process you want to assess. You will add its transcripts, procedures and flowcharts next.' : 'Nobody has added a process to this workspace yet.'}
        </EmptyState>
      ) : (
        <>
          {view === 'portfolio' ? <Portfolio store={store} nav={nav} processes={processes} workspaceId={workspace.id} /> : <>
          {canEdit && adding && <div className="rounded-xl border border-slate-200 bg-white p-4">{addForm}</div>}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_14rem_9rem] gap-4 border-b border-slate-200 px-5 py-2.5 text-xs font-semibold text-slate-500" aria-hidden>
              <span>Process</span><span>Where it stands</span><span className="text-right">Last changed</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {processes.map(p => {
                const st = status[p.id];
                return (
                  <li key={p.id}>
                    <a
                      href={`/process/${p.id}/sources`}
                      onClick={e => { e.preventDefault(); nav.go({ page: 'process', processId: p.id, stage: 'sources' }); }}
                      className="group grid grid-cols-[minmax(0,1fr)_14rem_9rem] items-center gap-4 px-5 py-3.5 hover:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold text-slate-900 group-hover:text-[#002C4B]">{p.name}</span>
                        {p.description && <span className="mt-0.5 block truncate text-sm text-slate-500">{p.description}</span>}
                      </span>
                      <span>{st && <Tag tone={STATUS_TONE[st.tone]} className="px-2 py-1 text-xs">{st.label}</Tag>}</span>
                      <span className="text-right text-xs text-slate-500" title={when(p.updatedAt)}>{ago(p.updatedAt)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
          </>}
        </>
      )}
    </section>
  );
}

export function FirstRun({ store, onCreated }: { store: JourneyStore; onCreated: () => void }) {
  const [org, setOrg] = React.useState('');
  const [ws, setWs] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mayCreate, setMayCreate] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    let live = true;
    store.canCreateOrganization().then(v => { if (live) setMayCreate(v); }).catch(() => { if (live) setMayCreate(false); });
    return () => { live = false; };
  }, [store]);
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
  if (mayCreate === null) return <Spinner />;
  if (!mayCreate) {
    return (
      <div className="mx-auto mt-6 max-w-md">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">You are not in a workspace yet</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Avala OS is by invitation. Ask an admin of your organization's workspace to add you from People, then sign in again.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto mt-6 max-w-md">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Set up your organization</h1>
      <p className="mt-1 text-sm text-slate-600">You are not a member of any workspace yet. Create one, or ask a colleague to add you to theirs.</p>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <Field label="Organization" required value={org} onChange={e => setOrg(e.target.value)} />
        <Field label="First workspace" placeholder="General" hint="A team or department, for example Finance Operations." value={ws} onChange={e => setWs(e.target.value)} />
        <ErrorNote message={error} />
        <Button type="submit" className="w-full" disabled={busy || !org.trim()}>Create organization</Button>
      </form>
    </div>
  );
}
