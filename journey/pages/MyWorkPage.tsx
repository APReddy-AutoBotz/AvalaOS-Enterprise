// The first screen after sign-in, the same for everyone: what needs you, the board items assigned to
// you, and the processes you are named on. What shows is derived from the state of the processes and
// the board, so an entry disappears when the work is done. Roles decide what you may do; names on a
// process and owners on the board decide what you see first.
import React from 'react';
import type { JourneyStore, Workspace } from '../store/types.ts';
import type { Nav } from '../JourneyApp.tsx';
import type { WorkItem } from '../../domain/workitems/board.ts';
import { STATUS_LABEL } from '../../domain/workitems/board.ts';
import { roleOf } from '../../domain/people/roles.ts';
import { itemsFor, needsFor, processesFor, type Duty, type Person, type ProcessFacts } from '../../domain/work/home.ts';
import { revisionStatus } from '../../domain/workspace/route.ts';
import { Button, cx, EmptyState, ErrorNote, messageOf, Spinner, Tag, TypeGlyph } from '../ui.tsx';
import { FirstRun, remember, remembered } from './ProcessesPage.tsx';

const DUTY: Record<Duty, string> = { analyst: 'Analyst', architect: 'Architect', approver: 'Approver' };
const STATUS_TONE = { neutral: 'neutral', draft: 'info', approved: 'ok', changed: 'warn' } as const;
const today = () => new Date().toISOString().slice(0, 10);
const dueText = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

interface Loaded { facts: (ProcessFacts & { statusLabel: string; statusTone: keyof typeof STATUS_TONE })[]; items: WorkItem[]; names: Map<string, string> }

export function MyWorkPage({ store, nav }: { store: JourneyStore; nav: Nav }) {
  const [workspaces, setWorkspaces] = React.useState<Workspace[] | null>(null);
  const [workspaceId, setWorkspaceId] = React.useState<string | null>(null);
  const [me, setMe] = React.useState<{ id: string; email: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const loadWorkspaces = React.useCallback(async () => {
    try {
      const [list, user] = await Promise.all([store.listWorkspaces(), store.currentUser()]);
      setMe(user);
      setWorkspaces(list);
      setWorkspaceId((list.find(w => w.id === remembered()) ?? list[0])?.id ?? null);
    } catch (e) { setError(messageOf(e)); }
  }, [store]);
  React.useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);

  if (error) return <ErrorNote message={error} />;
  if (!workspaces || !me) return <Spinner />;
  if (workspaces.length === 0) return <FirstRun store={store} onCreated={loadWorkspaces} />;
  const workspace = workspaces.find(w => w.id === workspaceId)!;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">{workspace.organizationName} · {workspace.name}</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">My work</h1>
          <p className="mt-1 text-sm text-slate-600">You are {article(roleOf({ access: workspace.role, canApprove: workspace.canApprove, job: workspace.job ?? null }).label)} here.</p>
        </div>
        {workspaces.length > 1 && (
          <label className="text-sm text-slate-600">
            <span className="mr-2">Workspace</span>
            <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={workspace.id} onChange={e => { setWorkspaceId(e.target.value); remember(e.target.value); }}>
              {workspaces.map(w => <option key={w.id} value={w.id}>{w.organizationName} · {w.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <React.Fragment key={workspace.id}><Home store={store} nav={nav} workspace={workspace} userId={me.id} /></React.Fragment>
    </div>
  );
}

const article = (label: string) => `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label.toLowerCase()}`;

function Home({ store, nav, workspace, userId }: { store: JourneyStore; nav: Nav; workspace: Workspace; userId: string }) {
  const [data, setData] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [processes, projects, members] = await Promise.all([store.listProcesses(workspace.id), store.listProjects(workspace.id), store.listMembers(workspace.id)]);
        const items = (await Promise.all(projects.map(p => store.listWorkItems(p.id)))).flat();
        const facts = await Promise.all(processes.map(async p => {
          const revisions = await store.listRevisions(p.id);
          const status = revisionStatus(revisions);
          const current = revisions.find(r => r.state === 'working') ?? revisions.find(r => r.state === 'approved');
          const [model, proposals] = await Promise.all([current ? store.getModel(current.id) : Promise.resolve(null), store.listProposals(p.id)]);
          return {
            id: p.id, name: p.name, analystId: p.analystId ?? null, architectId: p.architectId ?? null, approverId: p.approverId ?? null,
            status: (revisions.length === 0 ? 'none' : status.tone === 'approved' ? 'approved' : status.tone === 'changed' ? 'changed' : 'draft') as ProcessFacts['status'],
            openQuestions: model ? model.openQuestions.filter(q => q.status === 'open').length : 0,
            proposalsWaiting: proposals.filter(x => x.state === 'proposed' || x.state === 'selected').length,
            statusLabel: status.label, statusTone: status.tone,
          };
        }));
        if (live) setData({ facts, items, names: new Map(members.map(m => [m.userId, m.name])) });
      } catch (e) { if (live) setError(messageOf(e)); }
    })();
    return () => { live = false; };
  }, [store, workspace.id]);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Spinner />;

  const person: Person = { userId, access: workspace.role, canApprove: workspace.canApprove, job: workspace.job ?? null };
  const needs = needsFor(person, data.facts);
  const mine = itemsFor(userId, data.items, today());
  const { mine: myProcesses, unassigned } = processesFor(person, data.facts);
  const byId = new Map<string, Loaded["facts"][number]>(data.facts.map(f => [f.id, f] as const));
  const nothing = needs.length === 0 && mine.length === 0 && myProcesses.length === 0 && unassigned.length === 0;

  if (data.facts.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState title="No processes yet" action={workspace.role !== 'viewer' ? <Button onClick={() => nav.go({ page: 'processes' })}>Add a process</Button> : undefined}>
          {workspace.role !== 'viewer' ? 'Add the process you want to assess. Work that needs you will appear here.' : 'Nobody has added a process to this workspace yet.'}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {needs.length > 0 && (
        <section aria-labelledby="needs-you" className="rounded-xl border border-slate-200 bg-white" data-testid="needs-you">
          <h2 id="needs-you" className="border-b border-slate-100 px-5 py-3 font-display text-base font-semibold text-slate-900">Needs you</h2>
          <ul className="divide-y divide-slate-100">
            {needs.map(n => (
              <li key={`${n.processId}-${n.duty}-${n.text}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                <Tag tone="info">{DUTY[n.duty]}</Tag>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{n.text}</p>
                  <p className="truncate text-xs text-slate-500">{n.processName}{n.unassigned ? ' · Nobody is named for this yet' : ''}</p>
                </div>
                <Button variant="secondary" onClick={() => nav.go({ page: 'process', processId: n.processId, stage: n.stage })} aria-label={`${n.text}, ${n.processName}`}>Open</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mine.length > 0 && (
        <section aria-labelledby="my-items" className="rounded-xl border border-slate-200 bg-white" data-testid="my-items">
          <h2 id="my-items" className="border-b border-slate-100 px-5 py-3 font-display text-base font-semibold text-slate-900">My work items</h2>
          <ul className="divide-y divide-slate-100">
            {mine.map(({ item, overdue }) => (
              <li key={item.id}>
                <button type="button" onClick={() => nav.go({ page: 'board', projectId: item.projectId, itemId: item.id })} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50">
                  <TypeGlyph type={item.type} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{item.title}</span>
                  <span className="text-xs text-slate-500">{STATUS_LABEL[item.status]}</span>
                  {item.dueDate && <span className={cx('text-xs tabular-nums', overdue ? 'font-semibold text-red-700' : 'text-slate-500')}>{overdue ? 'Overdue · ' : 'Due '}{dueText(item.dueDate)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(myProcesses.length > 0 || unassigned.length > 0) && (
        <section aria-labelledby="my-processes" className="rounded-xl border border-slate-200 bg-white" data-testid="my-processes">
          <h2 id="my-processes" className="border-b border-slate-100 px-5 py-3 font-display text-base font-semibold text-slate-900">{myProcesses.length > 0 ? 'My processes' : 'Processes'}</h2>
          <ul className="divide-y divide-slate-100">
            {[...myProcesses.map(p => ({ p, mine: true })), ...unassigned.map(p => ({ p, mine: false }))].map(({ p, mine: isMine }) => {
              const f = byId.get(p.id)!;
              const roles = (['analyst', 'architect', 'approver'] as const).filter(d => (d === 'analyst' ? p.analystId : d === 'architect' ? p.architectId : p.approverId) === userId).map(d => DUTY[d]);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                  <a href={`/process/${p.id}/sources`} onClick={e => { e.preventDefault(); nav.go({ page: 'process', processId: p.id, stage: 'sources' }); }} className="min-w-0 flex-1 truncate text-sm font-semibold text-[#002C4B] hover:underline">{p.name}</a>
                  {isMine ? <span className="text-xs text-slate-500">{roles.join(', ')}</span> : <Tag tone="warn">Nobody named</Tag>}
                  <Tag tone={STATUS_TONE[f.statusTone]}>{f.statusLabel}</Tag>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {nothing && <EmptyState title="Nothing is waiting on you">Processes you are named on, and board items assigned to you, will appear here. Open Processes to see everything in this workspace.</EmptyState>}
      {!nothing && needs.length === 0 && <p className="text-sm text-slate-500" role="status">Nothing needs you right now.</p>}
      <p className="text-sm text-slate-500">
        <a href="/processes" className="font-medium text-[#002C4B] hover:underline" onClick={e => { e.preventDefault(); nav.go({ page: 'processes' }); }}>All processes</a>
        {' · '}
        <a href="/board" className="font-medium text-[#002C4B] hover:underline" onClick={e => { e.preventDefault(); nav.go({ page: 'board' }); }}>Delivery board</a>
      </p>
      <NeedsEmail store={store} />
    </div>
  );
}

/** The person's own choice: the weekday email when something new needs them (domain/work/digest.ts). */
function NeedsEmail({ store }: { store: JourneyStore }) {
  const [on, setOn] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { store.getNeedsEmail().then(setOn).catch(() => setOn(null)); }, [store]);
  if (on === null) return null;
  const change = async (next: boolean) => {
    setBusy(true); setError(null);
    try { await store.setNeedsEmail(next); setOn(next); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };
  return (
    <div className="border-t border-slate-200 pt-4" data-testid="needs-email">
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1" checked={on} disabled={busy} onChange={e => change(e.target.checked)} />
        <span>Email me on weekdays when something new needs me on a process I am named on.</span>
      </label>
      <ErrorNote message={error} />
    </div>
  );
}
