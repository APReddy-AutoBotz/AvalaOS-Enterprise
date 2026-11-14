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
import { homeSummary, itemsFor, needsByProcess, needsFor, processesFor, type Duty, type Person } from '../../domain/work/home.ts';
import { Button, cx, EmptyState, ErrorNote, messageOf, Spinner, Tag, TypeGlyph } from '../ui.tsx';
import { has } from '../../domain/workspace/modules.ts';
import { loadProcessFacts, STATUS_TONE, type LoadedFacts } from '../processFacts.ts';

const DUTY: Record<Duty, string> = { analyst: 'Analyst', architect: 'Architect', approver: 'Approver' };
const today = () => new Date().toISOString().slice(0, 10);
const dueText = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
/** Board items shown before "Show all". */
const ITEMS_SHOWN = 8;

interface Loaded { facts: LoadedFacts[]; items: WorkItem[]; names: Map<string, string> }

export function MyWorkPage({ store, nav, workspace, userId }: { store: JourneyStore; nav: Nav; workspace: Workspace; userId: string }) {
  const role = roleOf({ access: workspace.role, canApprove: workspace.canApprove, job: workspace.job ?? null }).label;
  return (
    <div>
      <p className="text-sm text-slate-500">{workspace.organizationName} · {workspace.name} · {role}</p>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">My work</h1>
      <Home store={store} nav={nav} workspace={workspace} userId={userId} />
    </div>
  );
}

const panel = 'overflow-hidden rounded-xl border border-slate-200 bg-white';
const heading = 'flex items-baseline gap-2 border-b border-slate-100 px-5 py-3 font-display text-base font-semibold text-slate-900';
const Count = ({ n }: { n: number }) => <span className="text-sm font-normal tabular-nums text-slate-500">{n}</span>;

function Home({ store, nav, workspace, userId }: { store: JourneyStore; nav: Nav; workspace: Workspace; userId: string }) {
  const [data, setData] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [allItems, setAllItems] = React.useState(false);
  // Only the parts the organisation uses (domain/workspace/modules.ts).
  const assess = has(workspace.modules, 'assess'), board = has(workspace.modules, 'board');

  React.useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [processes, projects, members] = await Promise.all([assess ? store.listProcesses(workspace.id) : Promise.resolve([]), board ? store.listProjects(workspace.id) : Promise.resolve([]), store.listMembers(workspace.id)]);
        const items = (await Promise.all(projects.map(p => store.listWorkItems(p.id)))).flat();
        const facts = await Promise.all(processes.map(p => loadProcessFacts(store, p)));
        if (live) setData({ facts, items, names: new Map(members.map(m => [m.userId, m.name])) });
      } catch (e) { if (live) setError(messageOf(e)); }
    })();
    return () => { live = false; };
  }, [store, workspace.id, assess, board]);

  if (error) return <div className="mt-6"><ErrorNote message={error} /></div>;
  if (!data) return <Spinner />;

  const person: Person = { userId, access: workspace.role, canApprove: workspace.canApprove, job: workspace.job ?? null };
  const needs = needsFor(person, data.facts);
  const groups = needsByProcess(needs);
  const mine = itemsFor(userId, data.items, today());
  const { mine: myProcesses, unassigned } = processesFor(person, data.facts);
  const byId = new Map<string, LoadedFacts>(data.facts.map(f => [f.id, f] as const));
  const nothing = needs.length === 0 && mine.length === 0 && myProcesses.length === 0 && unassigned.length === 0;
  const name = data.names.get(userId);
  const openProcess = (id: string) => nav.go({ page: 'process', processId: id, stage: 'sources' });

  if (!assess && mine.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState title="Nothing assigned to you yet" action={<Button onClick={() => nav.go({ page: 'board' })}>Open the Delivery board</Button>}>
          Items you own on the Delivery board appear here, with their status and due dates.
        </EmptyState>
      </div>
    );
  }
  if (assess && data.facts.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState title="No processes yet" action={workspace.role !== 'viewer' ? <Button onClick={() => nav.go({ page: 'processes' })}>Add a process</Button> : undefined}>
          {workspace.role !== 'viewer' ? 'Add the process you want to assess. Work that needs you will appear here.' : 'Nobody has added a process to this workspace yet.'}
        </EmptyState>
      </div>
    );
  }

  const shownItems = allItems ? mine : mine.slice(0, ITEMS_SHOWN);
  const processList = [...myProcesses.map(p => ({ p, mine: true })), ...unassigned.map(p => ({ p, mine: false }))];

  return (
    <div>
      <p className="mt-1 text-[15px] text-slate-700" data-testid="work-summary">{name ? `Welcome back, ${name}. ` : ''}{homeSummary(needs, mine)}</p>
      {nothing ? (
        <div className="mt-6"><EmptyState title="Nothing is waiting on you">Processes you are named on, and board items assigned to you, will appear here. Open Processes to see everything in this workspace.</EmptyState></div>
      ) : (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,3fr)]">
          <div className="space-y-6">
            {groups.length > 0 && (
              <section aria-labelledby="needs-you" className={panel} data-testid="needs-you">
                <h2 id="needs-you" className={heading}>Needs you <Count n={needs.length} /></h2>
                <ul className="divide-y divide-slate-100">
                  {groups.map(g => (
                    <li key={g.processId} className="px-5 py-3.5">
                      <a href={`/process/${g.processId}/sources`} onClick={e => { e.preventDefault(); openProcess(g.processId); }} className="text-sm font-semibold text-[#002C4B] hover:underline">{g.processName}</a>
                      <ul className="mt-2 space-y-2">
                        {g.needs.map(n => (
                          <li key={`${n.duty}-${n.text}`} className="flex items-center gap-3">
                            <span className="w-[4.75rem] shrink-0"><Tag tone="info">{DUTY[n.duty]}</Tag></span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm text-slate-900">{n.text}</span>
                              {n.unassigned && <span className="block text-xs text-slate-500">Nobody is named for this yet</span>}
                            </span>
                            <Button variant="secondary" onClick={() => nav.go({ page: 'process', processId: n.processId, stage: n.stage })} aria-label={`${n.text}, ${n.processName}`}>Open</Button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {mine.length > 0 && (
              <section aria-labelledby="my-items" className={panel} data-testid="my-items">
                <h2 id="my-items" className={heading}>My work items <Count n={mine.length} /></h2>
                <ul className="divide-y divide-slate-100">
                  {shownItems.map(({ item, overdue }) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => nav.go({ page: 'board', projectId: item.projectId, itemId: item.id })} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-50">
                        <TypeGlyph type={item.type} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{item.title}</span>
                        {item.dueDate && <span className={cx('whitespace-nowrap text-xs tabular-nums', overdue ? 'font-semibold text-red-700' : 'text-slate-500')}>{overdue ? 'Overdue · ' : 'Due '}{dueText(item.dueDate)}</span>}
                        <span className="w-28 shrink-0 text-right text-xs text-slate-500">{STATUS_LABEL[item.status]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {mine.length > ITEMS_SHOWN && (
                  <div className="border-t border-slate-100 px-5 py-2.5">
                    <button type="button" aria-expanded={allItems} onClick={() => setAllItems(!allItems)} className="text-sm font-semibold text-[#002C4B] hover:underline">{allItems ? `Show the first ${ITEMS_SHOWN}` : `Show all ${mine.length}`}</button>
                  </div>
                )}
              </section>
            )}
          </div>

          {processList.length > 0 && (
            <section aria-labelledby="my-processes" className={panel} data-testid="my-processes">
              <h2 id="my-processes" className={heading}>{myProcesses.length > 0 ? 'My processes' : 'Processes'} <Count n={processList.length} /></h2>
              <ul className="divide-y divide-slate-100">
                {processList.map(({ p, mine: isMine }) => {
                  const f = byId.get(p.id)!;
                  const roles = (['analyst', 'architect', 'approver'] as const).filter(d => (d === 'analyst' ? p.analystId : d === 'architect' ? p.architectId : p.approverId) === userId).map(d => DUTY[d]);
                  return (
                    <li key={p.id} className="px-5 py-3">
                      <a href={`/process/${p.id}/sources`} onClick={e => { e.preventDefault(); openProcess(p.id); }} className="block truncate text-sm font-semibold text-[#002C4B] hover:underline">{p.name}</a>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Tag tone={STATUS_TONE[f.statusTone]}>{f.statusLabel}</Tag>
                        {isMine ? <span className="text-xs text-slate-500">{roles.join(', ')}</span> : <Tag tone="warn">Nobody named</Tag>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
