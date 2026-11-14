// The first screen after sign-in, the same for everyone: what needs you, the board items assigned to
// you, and the processes you are named on. What shows is derived from the state of the processes and
// the board, so an entry disappears when the work is done. Roles decide what you may do; names on a
// process and owners on the board decide what you see first.
//
// The page is light; the one coloured block is "Needs you", so the eye lands on it. It adapts to how
// much there is: one need is a single large card, several are a list grouped by process; one process
// shows its figures, several are compact rows.
import React from 'react';
import type { JourneyStore, Workspace } from '../store/types.ts';
import type { Nav } from '../JourneyApp.tsx';
import type { WorkItem, WorkStatus } from '../../domain/workitems/board.ts';
import { STATUS_LABEL } from '../../domain/workitems/board.ts';
import { roleOf } from '../../domain/people/roles.ts';
import { homeSummary, itemsFor, needsByProcess, needsFor, openOn, processesFor, type Need, type Person } from '../../domain/work/home.ts';
import { cardTotals } from '../../domain/assess/portfolio.ts';
import type { StageId } from '../../domain/workspace/route.ts';
import { Button, CARD, cx, EmptyState, ErrorNote, messageOf, PageHead, Spinner, Tag, TypeGlyph } from '../ui.tsx';
import { has } from '../../domain/workspace/modules.ts';
import { loadProcessFacts, type LoadedFacts } from '../processFacts.ts';
import { cardLine, DUTY, Figures, hrs, People, Pill, StatusPill } from '../processCard.tsx';

const today = () => new Date().toISOString().slice(0, 10);
const dueText = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
/** Board items shown before "Show all". */
const ITEMS_SHOWN = 8;
/** Processes shown before "Show all", in "Needs you" and in "My processes". */
const PROCESSES_SHOWN = 6;

/** What the button of a single need says: the thing to do at the stage it opens. */
const ACTION: Partial<Record<StageId, string>> = { sources: 'Add sources', documents: 'Answer them', 'work-items': 'Review them', process: 'Review it' };
const DOT: Record<WorkStatus, string> = {
  todo: 'bg-slate-400', in_progress: 'bg-sky-600', in_review: 'bg-violet-600', testing: 'bg-amber-600',
  ready_for_release: 'bg-teal-600', done: 'bg-emerald-600', blocked: 'bg-red-600', on_hold: 'bg-slate-500',
};

interface Loaded { facts: LoadedFacts[]; items: WorkItem[]; names: Map<string, string> }

export function MyWorkPage({ store, nav, workspace, userId }: { store: JourneyStore; nav: Nav; workspace: Workspace; userId: string }) {
  const role = roleOf({ access: workspace.role, canApprove: workspace.canApprove, job: workspace.job ?? null }).label;
  const eyebrow = `${workspace.organizationName} · ${workspace.name} · ${role}`;
  const [data, setData] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [allItems, setAllItems] = React.useState(false);
  const [allProcesses, setAllProcesses] = React.useState(false);
  // Only the parts the organisation uses (domain/workspace/modules.ts).
  const assess = has(workspace.modules, 'assess'), board = has(workspace.modules, 'board');

  React.useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [processes, projects, members, settings] = await Promise.all([
          assess ? store.listProcesses(workspace.id) : Promise.resolve([]), board ? store.listProjects(workspace.id) : Promise.resolve([]), store.listMembers(workspace.id),
          // The lines the figures are measured against; the defaults apply when they cannot be read.
          assess ? store.getSettings(workspace.id).then(r => r.settings).catch(() => undefined) : Promise.resolve(undefined),
        ]);
        const items = (await Promise.all(projects.map(p => store.listWorkItems(p.id)))).flat();
        const facts = await Promise.all(processes.map(p => loadProcessFacts(store, p, settings)));
        if (live) setData({ facts, items, names: new Map(members.map(m => [m.userId, m.name])) });
      } catch (e) { if (live) setError(messageOf(e)); }
    })();
    return () => { live = false; };
  }, [store, workspace.id, assess, board]);

  if (error) return <div><PageHead eyebrow={eyebrow} title="My work" /><div className="mt-6"><ErrorNote message={error} /></div></div>;
  if (!data) return <div><p className="text-[13px] font-medium text-slate-500">{eyebrow}</p><Spinner /></div>;

  const person: Person = { userId, access: workspace.role, canApprove: workspace.canApprove, job: workspace.job ?? null };
  const needs = needsFor(person, data.facts);
  const groups = needsByProcess(needs);
  const mine = itemsFor(userId, data.items, today());
  const { mine: myProcesses, unassigned } = processesFor<LoadedFacts>(person, data.facts);
  const nothing = needs.length === 0 && mine.length === 0 && myProcesses.length === 0 && unassigned.length === 0;
  const name = data.names.get(userId);
  const nameOf = (id: string) => data.names.get(id) ?? 'Someone no longer in this workspace';
  const openProcess = (id: string) => nav.go({ page: 'process', processId: id, stage: 'sources' });
  const processList = [...myProcesses.map(p => ({ p, mine: true })), ...unassigned.map(p => ({ p, mine: false }))];
  const hours = cardTotals(processList.map(x => x.p.card)).hours;

  // The figures beside the greeting: counted from what the page lists, and left out when there is nothing to count.
  const figures = [
    mine.length > 0 && { value: String(mine.length), label: mine.length === 1 ? 'board item is yours' : 'board items are yours' },
    myProcesses.length > 0 && { value: String(myProcesses.length), label: myProcesses.length === 1 ? 'process you are named on' : 'processes you are named on' },
    hours > 0 && { value: hrs(hours), label: 'hours a year automation could take, at most' },
  ].filter((f): f is { value: string; label: string } => Boolean(f));

  const head = (
    <PageHead eyebrow={eyebrow} title={name ? `Welcome back, ${name}` : 'My work'} summary={<span data-testid="work-summary">{homeSummary(needs, mine)}</span>}>
      {figures.length > 0 && (
        <ul className="flex flex-wrap gap-y-3" data-testid="work-figures">
          {figures.map(f => (
            <li key={f.label} className="border-l border-slate-300 px-7 py-0.5 last:pr-0">
              <span className="block font-display text-[2rem] font-semibold leading-tight tabular-nums text-[#002C4B]">{f.value}</span>
              <span className="mt-1 block max-w-[10.5rem] text-[13px] leading-snug text-slate-600">{f.label}</span>
            </li>
          ))}
        </ul>
      )}
    </PageHead>
  );

  if (!assess && mine.length === 0) {
    return (
      <div>{head}
        <div className="mt-8">
          <EmptyState title="Nothing assigned to you yet" action={<Button onClick={() => nav.go({ page: 'board' })}>Open the Delivery board</Button>}>
            Items you own on the Delivery board appear here, with their status and due dates.
          </EmptyState>
        </div>
      </div>
    );
  }
  if (assess && data.facts.length === 0) {
    return (
      <div>{head}
        <div className="mt-8">
          <EmptyState title="No processes yet" action={workspace.role !== 'viewer' ? <Button variant="accent" onClick={() => nav.go({ page: 'processes' })}>Add a process</Button> : undefined}>
            {workspace.role !== 'viewer' ? 'Add the process you want to assess. Work that needs you will appear here.' : 'Nobody has added a process to this workspace yet.'}
          </EmptyState>
        </div>
      </div>
    );
  }

  const shownItems = allItems ? mine : mine.slice(0, ITEMS_SHOWN);
  const shownProcesses = allProcesses ? processList : processList.slice(0, PROCESSES_SHOWN);
  const heading = 'font-display text-xl font-semibold text-slate-900';
  const more = 'rounded text-sm font-semibold text-[#002C4B] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002C4B]';

  return (
    <div>
      {head}
      {nothing ? (
        <div className="mt-8"><EmptyState title="Nothing is waiting on you">Processes you are named on, and board items assigned to you, will appear here. Open Processes to see everything in this workspace.</EmptyState></div>
      ) : (
        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,3fr)]">
          <div className="space-y-6">
            {needs.length > 0 && <NeedsYou needs={needs} groups={groups} nav={nav} />}

            {mine.length > 0 && (
              <section aria-labelledby="my-items" className={cx(CARD, 'overflow-hidden')} data-testid="my-items">
                <div className="flex items-baseline gap-2.5 px-6 py-4">
                  <h2 id="my-items" className={heading}>My work items</h2>
                  <span className="text-sm tabular-nums text-slate-500">{mine.length}</span>
                  <a href="/board" onClick={e => { e.preventDefault(); nav.go({ page: 'board' }); }} className={cx(more, 'ml-auto')}>Open the board</a>
                </div>
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {shownItems.map(({ item, overdue }) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => nav.go({ page: 'board', projectId: item.projectId, itemId: item.id })} className="flex w-full items-center gap-3 px-6 py-3 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#002C4B]">
                        <TypeGlyph type={item.type} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{item.title}</span>
                        {item.dueDate && <span className={cx('whitespace-nowrap text-xs tabular-nums', overdue ? 'font-semibold text-red-700' : 'text-slate-500')}>{overdue ? 'Overdue · ' : 'Due '}{dueText(item.dueDate)}</span>}
                        <span className="flex w-36 shrink-0 items-center gap-2 text-[13px] text-slate-600"><span aria-hidden className={cx('h-2 w-2 rounded-full', DOT[item.status])} />{STATUS_LABEL[item.status]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {mine.length > ITEMS_SHOWN && (
                  <div className="border-t border-slate-100 px-6 py-3">
                    <button type="button" aria-expanded={allItems} onClick={() => setAllItems(!allItems)} className={more}>{allItems ? `Show the first ${ITEMS_SHOWN}` : `Show all ${mine.length}`}</button>
                  </div>
                )}
              </section>
            )}
          </div>

          {processList.length > 0 && (
            <section aria-labelledby="my-processes" className={cx(CARD, 'overflow-hidden')} data-testid="my-processes">
              <div className="flex items-baseline gap-2.5 px-6 py-4">
                <h2 id="my-processes" className={heading}>{myProcesses.length > 0 ? 'My processes' : 'Processes'}</h2>
                <span className="text-sm tabular-nums text-slate-500">{processList.length}</span>
              </div>
              {processList.length === 1 ? (
                <OneProcess p={processList[0]!.p} mine={processList[0]!.mine} userId={userId} nameOf={nameOf} open={openProcess} />
              ) : (
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {shownProcesses.map(({ p, mine: isMine }) => (
                    <li key={p.id} className="px-6 py-3.5">
                      <a href={`/process/${p.id}/sources`} onClick={e => { e.preventDefault(); openProcess(p.id); }} className="block truncate text-[15px] font-semibold text-slate-900 hover:text-[#002C4B] hover:underline">{p.name}</a>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <StatusPill facts={p} />
                        {isMine ? <span className="text-xs text-slate-600">{rolesOf(p, userId).join(', ')}</span> : <Tag tone="warn">Nobody named</Tag>}
                      </div>
                      <p className="mt-1.5 text-[13px] leading-5 text-slate-600">{p.card ? cardLine(p.card) : notAssessed(p)}</p>
                    </li>
                  ))}
                </ul>
              )}
              {processList.length > PROCESSES_SHOWN && (
                <div className="border-t border-slate-100 px-6 py-3">
                  <button type="button" aria-expanded={allProcesses} onClick={() => setAllProcesses(!allProcesses)} className={more}>{allProcesses ? `Show the first ${PROCESSES_SHOWN}` : `Show all ${processList.length}`}</button>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

const rolesOf = (p: LoadedFacts, userId: string) => (['analyst', 'architect', 'approver'] as const).filter(d => (d === 'analyst' ? p.analystId : d === 'architect' ? p.architectId : p.approverId) === userId).map(d => DUTY[d]);
/** What to say in place of the figures while a process has nothing to assess. */
const notAssessed = (p: LoadedFacts) => (p.status === 'none' ? 'No sources yet, so nothing to assess.' : `Not assessed yet${openOn(p).length ? `: ${openOn(p).join(', ')}.` : '.'}`);

/** The only process a person has: room for its figures and the people on it. */
function OneProcess({ p, mine, userId, nameOf, open }: { p: LoadedFacts; mine: boolean; userId: string; nameOf: (id: string) => string; open: (id: string) => void }) {
  return (
    <div className="border-t border-slate-100 px-6 pb-6 pt-5">
      <a href={`/process/${p.id}/sources`} onClick={e => { e.preventDefault(); open(p.id); }} className="font-display text-lg font-semibold text-slate-900 hover:text-[#002C4B] hover:underline">{p.name}</a>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <StatusPill facts={p} />
        {mine && <Pill>You: {rolesOf(p, userId).join(', ')}</Pill>}
      </div>
      {p.card ? <Figures card={p.card} className="mt-4 grid-cols-2 [&>*:first-child]:col-span-2" /> : <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">{notAssessed(p)}</p>}
      <div className="mt-4"><People facts={p} nameOf={nameOf} /></div>
    </div>
  );
}

const NeedMark = () => (
  <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#E69F00]">
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="#002C4B" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-6l-4 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z" />
      <path d="M12 8.6v3.6" /><circle cx="12" cy="14.3" r="0.5" fill="#002C4B" />
    </svg>
  </span>
);

/**
 * What is waiting on this person: the one coloured block of the page. A single need is set large with
 * its own action; several are listed under the process they belong to.
 */
function NeedsYou({ needs, groups, nav }: { needs: Need[]; groups: ReturnType<typeof needsByProcess>; nav: Nav }) {
  const [all, setAll] = React.useState(false);
  const openNeed = (n: Need) => nav.go({ page: 'process', processId: n.processId, stage: n.stage });
  const processLink = (id: string, name: string, className: string) => (
    <a href={`/process/${id}/sources`} onClick={e => { e.preventDefault(); nav.go({ page: 'process', processId: id, stage: 'sources' }); }} className={className}>{name}</a>
  );
  const frame = 'rounded-2xl border border-[#EFCF7A] bg-[#FFF8E6] shadow-attention';
  const label = 'text-[13px] font-bold uppercase tracking-wide text-[#6B4A00]';

  if (needs.length === 1) {
    const n = needs[0]!;
    const action = ACTION[n.stage] ?? 'Open';
    return (
      <section aria-labelledby="needs-you" className={cx(frame, 'flex flex-wrap items-center gap-x-6 gap-y-4 px-6 py-6')} data-testid="needs-you">
        <NeedMark />
        <div className="min-w-0 flex-1 basis-72">
          <h2 id="needs-you" className={label}>Needs you</h2>
          <p className="mt-1.5 font-display text-2xl font-semibold leading-tight text-slate-900">{n.text}</p>
          <p className="mt-1.5 text-sm leading-6 text-slate-700">
            On {processLink(n.processId, n.processName, 'font-semibold text-[#002C4B] underline-offset-2 hover:underline')}{n.unassigned ? `, for its ${DUTY[n.duty].toLowerCase()}. Nobody is named for this yet.` : `, where you are the ${DUTY[n.duty].toLowerCase()}.`}
          </p>
        </div>
        <Button variant="accent" className="min-h-11 px-5 text-[15px]" onClick={() => openNeed(n)} aria-label={`${action}: ${n.text}, ${n.processName}`}>
          {action}
          <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" /></svg>
        </Button>
      </section>
    );
  }

  const shown = all ? groups : groups.slice(0, PROCESSES_SHOWN);
  return (
    <section aria-labelledby="needs-you" className={cx(frame, 'p-5 sm:p-6')} data-testid="needs-you">
      <div className="flex items-center gap-4">
        <NeedMark />
        <div className="min-w-0">
          <h2 id="needs-you" className={label}>Needs you</h2>
          <p className="mt-1 font-display text-2xl font-semibold leading-tight text-slate-900">{needs.length} things to do{groups.length > 1 ? ` across ${groups.length} processes` : ''}</p>
        </div>
      </div>
      <ul className="mt-5 space-y-3">
        {shown.map(g => (
          <li key={g.processId} className="rounded-xl border border-[#F3E2B0] bg-white px-4 pb-1 pt-3">
            {processLink(g.processId, g.processName, 'text-sm font-semibold text-[#002C4B] hover:underline')}
            <ul className="mt-1 divide-y divide-slate-100">
              {g.needs.map(n => (
                <li key={`${n.duty}-${n.text}`} className="flex items-center gap-3 py-2.5">
                  <span className="w-[4.75rem] shrink-0"><Tag tone="info">{DUTY[n.duty]}</Tag></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-slate-900">{n.text}</span>
                    {n.unassigned && <span className="block text-xs text-slate-600">Nobody is named for this yet</span>}
                  </span>
                  <Button variant="secondary" onClick={() => openNeed(n)} aria-label={`Open: ${n.text}, ${n.processName}`}>Open</Button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {groups.length > PROCESSES_SHOWN && (
        <button type="button" aria-expanded={all} onClick={() => setAll(!all)} className="mt-4 rounded text-sm font-semibold text-[#002C4B] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002C4B]">{all ? `Show the first ${PROCESSES_SHOWN} processes` : `Show all ${groups.length} processes`}</button>
      )}
    </section>
  );
}
