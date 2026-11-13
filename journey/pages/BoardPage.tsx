// The Delivery board: confirmed work, in lanes by epic and columns by status. Epics head the lanes
// (as in Jira and Azure DevOps) and are not cards. Cards move between columns (drag, or the status
// in the item panel); every change is saved at once. The item panel shows what "done" means and the
// linked requirements, and warns when a requirement changed after the item was confirmed; the item
// itself is never changed for you.
import React from 'react';
import type { JourneyStore, Member, Workspace } from '../store/types.ts';
import type { Nav } from '../JourneyApp.tsx';
import { BoardError, COLUMNS, criterionParts, initials, joinStory, lanesOf, planningFacts, splitStory, STATUS_LABEL, upstreamChanges, validateEdit, validateProjectName, type Project, type WorkItem, type WorkItemEdit, type WorkStatus } from '../../domain/workitems/board.ts';
import type { StoredRequirement } from '../../domain/requirements/register.ts';
import { Button, cx, EmptyState, ErrorNote, messageOf, Progress, Spinner, Tag, TypeGlyph, when, WORK_TYPE } from '../ui.tsx';

const WORKSPACE_KEY = 'avala.journey.workspace';
const remembered = () => { try { return localStorage.getItem(WORKSPACE_KEY); } catch { return null; } };
const MAIN: WorkStatus[] = ['todo', 'in_progress', 'in_review', 'testing', 'ready_for_release', 'done'];
const TRACK = 'grid grid-cols-[repeat(6,minmax(13.5rem,1fr))] gap-[3px]';

// One colour per status and per type, used the same way on the board and in the panel.
const STATUS_DOT: Record<WorkStatus, string> = { todo: 'bg-slate-400', in_progress: 'bg-sky-600', in_review: 'bg-violet-500', testing: 'bg-amber-500', ready_for_release: 'bg-teal-500', done: 'bg-emerald-600', blocked: 'bg-red-600', on_hold: 'bg-slate-500' };
const TYPE = WORK_TYPE;
const StatusLabel = ({ status, className }: { status: WorkStatus; className?: string }) => (
  <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600', className)}><span className={cx('h-1.5 w-1.5 rounded-full', STATUS_DOT[status])} aria-hidden />{STATUS_LABEL[status]}</span>
);
const ChangedTag = () => <Tag tone="warn">Upstream changed</Tag>;
export function BoardPage({ store, nav, projectId, itemId }: { store: JourneyStore; nav: Nav; projectId?: string; itemId?: string }) {
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null);
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  const [items, setItems] = React.useState<WorkItem[] | null>(null);
  const [reqs, setReqs] = React.useState<Record<string, StoredRequirement[]>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const [closed, setClosed] = React.useState<Set<string>>(new Set());
  const [members, setMembers] = React.useState<Member[]>([]);
  const [who, setWho] = React.useState<string>(''); // '' everyone, 'none' unassigned, else a member

  React.useEffect(() => {
    store.listWorkspaces().then(async list => {
      const w = list.find(x => x.id === remembered()) ?? list[0] ?? null;
      setWorkspace(w);
      setProjects(w ? await store.listProjects(w.id) : []);
      if (w) store.listMembers(w.id).then(setMembers).catch(() => {});
    }).catch(e => setError(messageOf(e)));
  }, [store]);
  const project = projects?.find(p => p.id === projectId) ?? null;
  React.useEffect(() => {
    if (projects && !projectId && projects[0]) nav.go({ page: 'board', projectId: projects[0].id }, { replace: true });
  }, [projects, projectId, nav]);
  React.useEffect(() => {
    if (!project) { setItems(null); return; }
    store.listWorkItems(project.id).then(async list => {
      setItems(list);
      const procs = [...new Set(list.map(i => i.processId).filter((x): x is string => Boolean(x)))];
      const all = await Promise.all(procs.map(p => store.listRequirements(p).then(r => [p, r] as const)));
      setReqs(Object.fromEntries(all));
    }).catch(e => setError(messageOf(e)));
  }, [store, project]);

  const update = async (item: WorkItem, e: WorkItemEdit) => {
    setError(null);
    try {
      const next = await store.updateWorkItem(item.id, validateEdit(item, e));
      setItems(cur => (cur ?? []).map(x => (x.id === item.id ? next : x)));
    } catch (x) { setError(x instanceof BoardError ? x.message : messageOf(x)); }
  };
  const create = async () => {
    if (!workspace) return;
    setError(null);
    try {
      const p = await store.createProject(workspace.id, validateProjectName(newName));
      setProjects(cur => [...(cur ?? []), p]); setNewName(''); setAdding(false);
      nav.go({ page: 'board', projectId: p.id });
    } catch (x) { setError(x instanceof BoardError ? x.message : messageOf(x)); }
  };

  if (!projects) return error ? <ErrorNote message={error} /> : <Spinner />;
  const canEdit = workspace?.role !== 'viewer';
  const open = items?.find(i => i.id === itemId) ?? null;
  const openItem = (id: string) => { if (project) nav.go({ page: 'board', projectId: project.id, itemId: id }); };
  const changesOf = (i: WorkItem) => (i.processId ? upstreamChanges(i, (reqs[i.processId] ?? []).map(r => ({ code: r.code, statement: r.statement, state: r.state }))) : []);
  const q = query.trim().toLowerCase();
  const nameOf = (id: string | null) => (id ? members.find(m => m.userId === id)?.name ?? 'Someone no longer in this workspace' : null);
  const matches = (i: WorkItem) => (!who || (who === 'none' ? !i.ownerId : i.ownerId === who))
    && (!q || i.title.toLowerCase().includes(q) || i.requirements.some(c => c.toLowerCase().includes(q)) || TYPE[i.type].label.toLowerCase() === q || (nameOf(i.ownerId) ?? '').toLowerCase().includes(q));
  const filtering = Boolean(q || who);
  const lanes = lanesOf(items ?? []);
  const work = (items ?? []).filter(i => i.type !== 'epic');
  // Lanes with work come first; an epic with nothing on the board yet is a single line below them.
  const shown = lanes.map(l => ({ ...l, cards: l.items.filter(matches) })).filter(l => !filtering || l.cards.length).sort((a, b) => Number(!a.items.length) - Number(!b.items.length));
  const field = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';

  return (
    <section className="space-y-5" data-testid="board">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="font-display text-2xl font-semibold text-slate-900">Delivery board</h1>
        {projects.length > 0 && (
          <select aria-label="Project" value={projectId ?? ''} onChange={e => nav.go({ page: 'board', projectId: e.target.value })} className={cx(field, 'max-w-[18rem] font-medium')}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {work.length > 0 && <Progress done={work.filter(i => i.status === 'done').length} total={work.length} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {work.length > 0 && members.length > 0 && (
            <select aria-label="Show work of" value={who} onChange={e => setWho(e.target.value)} className={field}>
              <option value="">Everyone's work</option>
              {members.map(m => <option key={m.userId} value={m.userId}>{m.name}</option>)}
              <option value="none">Unassigned</option>
            </select>
          )}
          {work.length > 0 && <input type="search" aria-label="Find an item" placeholder="Find by title or FR code" value={query} onChange={e => setQuery(e.target.value)} className={cx(field, 'w-56')} />}
          {canEdit && (adding
            ? <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); create(); }}>
                <input autoFocus aria-label="New project name" placeholder="Project name" value={newName} onChange={e => setNewName(e.target.value)} className={cx(field, 'w-48')} />
                <Button type="submit">Create project</Button>
                <Button type="button" variant="ghost" onClick={() => { setAdding(false); setNewName(''); }}>Cancel</Button>
              </form>
            : <Button variant="secondary" onClick={() => setAdding(true)}>New project</Button>)}
        </div>
      </div>
      <ErrorNote message={error} />
      {!projects.length && <EmptyState title="No projects yet">A project is created when you confirm work items from a process's Work items stage. You can also start an empty one with New project.</EmptyState>}
      {project && !items && <Spinner />}
      {project && items && !items.length && <EmptyState title="Nothing on this board yet">Open a process, go to Work items, and confirm the items you want. They arrive here in To do.</EmptyState>}
      {project && items && items.length > 0 && (
        <div className="overflow-x-auto pb-2">
          <div className="min-w-[84rem]">
            <div className={cx(TRACK, 'px-0 pb-2')} aria-hidden>
              {MAIN.map(status => (
                <div key={status} className="flex items-center gap-2 px-2.5 text-[13px] font-semibold text-slate-700">
                  <span className={cx('h-2 w-2 rounded-full', STATUS_DOT[status])} />{STATUS_LABEL[status]}
                  <span className="font-normal tabular-nums text-slate-400">{work.filter(i => i.status === status).length}</span>
                </div>
              ))}
            </div>
            <div className="space-y-4">
              {shown.map(lane => {
                const id = lane.epic?.id ?? 'none';
                const isClosed = closed.has(id) && !filtering;
                const parked = lane.cards.filter(i => i.status === 'blocked' || i.status === 'on_hold');
                return (
                  <section key={id} aria-label={lane.epic?.title ?? 'Work without an epic'}>
                    <div className="flex items-center gap-2.5 px-1 pb-1.5" data-testid={lane.epic ? 'epic-lane' : 'loose-lane'}>
                      <button type="button" disabled={!lane.items.length} aria-expanded={!isClosed} aria-label={`${isClosed ? 'Show' : 'Hide'} the items in this lane`} onClick={() => setClosed(cur => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; })} className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:invisible">
                        <svg viewBox="0 0 12 12" className={cx('h-3 w-3 transition-transform', !isClosed && 'rotate-90')} aria-hidden><path d="m4.2 2.5 3.6 3.5-3.6 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                      {lane.epic ? <>
                        <TypeGlyph type="epic" />
                        <button type="button" data-testid="epic-open" title={lane.epic.title} onClick={() => openItem(lane.epic!.id)} className="min-w-0 truncate text-left text-sm font-semibold text-slate-900 hover:text-[#002C4B] hover:underline">{lane.epic.title}</button>
                        <StatusLabel status={lane.epic.status} />
                        {changesOf(lane.epic).length > 0 && <ChangedTag />}
                      </> : <span className="text-sm font-semibold text-slate-600">Work without an epic</span>}
                      {lane.items.length > 0 ? <Progress done={lane.done} total={lane.items.length} className="ml-auto" /> : <span className="ml-auto whitespace-nowrap text-xs text-slate-500">No work on the board under this epic yet</span>}
                    </div>
                    {!isClosed && parked.length > 0 && (
                      <div className="mb-[3px] flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-900" data-testid="blocked">
                        <span className="font-semibold">Not moving</span>
                        {parked.map(i => <button key={i.id} type="button" onClick={() => openItem(i.id)} className="rounded-md bg-white px-2 py-1 text-left text-slate-800 ring-1 ring-inset ring-red-200 hover:ring-red-400">{i.title} <span className="text-red-800">({STATUS_LABEL[i.status]})</span></button>)}
                      </div>
                    )}
                    {!isClosed && lane.items.length > 0 && (
                      <div className={cx(TRACK, 'overflow-hidden rounded-xl')} role="list" aria-label="Columns">
                        {MAIN.map(status => {
                          const col = lane.cards.filter(i => i.status === status);
                          const key = `${id}:${status}`;
                          return (
                            <div key={status} role="listitem" aria-label={STATUS_LABEL[status]} data-testid={`column-${status}`}
                              onDragOver={e => { if (canEdit && dragging) { e.preventDefault(); if (over !== key) setOver(key); } }}
                              onDragLeave={() => setOver(cur => (cur === key ? null : cur))}
                              onDrop={e => { e.preventDefault(); const it = items.find(i => i.id === dragging); if (it && it.status !== status) update(it, { status }); setDragging(null); setOver(null); }}
                              className={cx('min-h-[4.5rem] p-1.5 transition-colors', over === key ? 'bg-[#D9E6F2]' : 'bg-[#EDF1F5]')}>
                              <ul className="space-y-1.5">
                                {col.map(i => {
                                  const facts = planningFacts(i);
                                  return (
                                    <li key={i.id} draggable={canEdit} onDragStart={() => setDragging(i.id)} onDragEnd={() => { setDragging(null); setOver(null); }} data-testid="board-card" className={cx(dragging === i.id && 'opacity-40')}>
                                      <button type="button" title={i.title} onClick={() => openItem(i.id)} className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left shadow-[0_1px_1px_rgba(15,23,42,0.04)] transition-shadow hover:border-slate-300 hover:shadow-[0_3px_10px_rgba(15,23,42,0.09)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#002C4B]">
                                        <span className="line-clamp-3 text-[13px] font-medium leading-[1.4] text-slate-900">{i.title}</span>
                                        {changesOf(i).length > 0 && <span className="mt-1.5 block"><ChangedTag /></span>}
                                        <span className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                                          <TypeGlyph type={i.type} />{TYPE[i.type].label}
                                          {i.priority === 'high' && <span className="font-semibold text-red-700">High</span>}
                                          <span className="ml-auto flex items-center gap-2 tabular-nums">
                                            {facts.date && <span>{facts.date}</span>}
                                            {facts.estimate && <span>{facts.estimate}</span>}
                                            {i.requirements[0] && <span className="font-medium text-slate-600">{i.requirements[0]}{i.requirements.length > 1 ? ` +${i.requirements.length - 1}` : ''}</span>}
                                            {i.ownerId && <OwnerMark name={nameOf(i.ownerId)!} />}
                                          </span>
                                        </span>
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
              {filtering && !shown.length && <p className="py-10 text-center text-sm text-slate-600">Nothing on this board matches{q ? ` "${query.trim()}"` : ' that choice'}.</p>}
            </div>
          </div>
        </div>
      )}
      {open && project && items && <React.Fragment key={open.id}><ItemPanel item={open} items={items} members={members} canEdit={canEdit} reqs={open.processId ? reqs[open.processId] ?? [] : []} changes={changesOf(open)} onClose={() => nav.go({ page: 'board', projectId: project.id })} onOpen={openItem} onSave={e => update(open, e)} onOpenFrd={() => { if (open.processId) nav.go({ page: 'process', processId: open.processId, stage: 'documents' }); }} /></React.Fragment>}
    </section>
  );
}

/** A person's mark: two letters in a circle, with the name on hover and for screen readers. */
const OwnerMark = ({ name }: { name: string }) => (
  <span title={name} aria-label={`Owner: ${name}`} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#002C4B] text-[9px] font-semibold tracking-wide text-white">{initials(name)}</span>
);

/** A text area that is as tall as its text, so a title or description reads like the page, not a form. */
function useAutosize(value: string) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => { const el = ref.current; if (el) { el.style.height = '0px'; el.style.height = `${el.scrollHeight}px`; } }, [value]);
  return ref;
}

function ItemPanel({ item, items, members, canEdit, reqs, changes, onClose, onOpen, onSave, onOpenFrd }: { item: WorkItem; items: WorkItem[]; members: Member[]; canEdit: boolean; reqs: StoredRequirement[]; changes: ReturnType<typeof upstreamChanges>; onClose: () => void; onOpen: (id: string) => void; onSave: (e: WorkItemEdit) => Promise<void>; onOpenFrd: () => void }) {
  const { story, rest } = splitStory(item.description);
  const [title, setTitle] = React.useState(item.title);
  const [description, setDescription] = React.useState(rest);
  const [line, setLine] = React.useState(story ?? '');
  const [estimate, setEstimate] = React.useState(item.estimateHours === null ? '' : String(item.estimateHours));
  const [due, setDue] = React.useState(item.dueDate ?? '');
  const [start, setStart] = React.useState(item.startDate ?? '');
  const dirty = title !== item.title || description !== rest || line !== (story ?? '') || estimate !== (item.estimateHours === null ? '' : String(item.estimateHours)) || due !== (item.dueDate ?? '') || start !== (item.startDate ?? '');
  const reset = () => { setTitle(item.title); setDescription(rest); setLine(story ?? ''); setEstimate(item.estimateHours === null ? '' : String(item.estimateHours)); setDue(item.dueDate ?? ''); setStart(item.startDate ?? ''); };
  const titleRef = useAutosize(title), descRef = useAutosize(description), storyRef = useAutosize(line);
  const parent = item.parentId ? items.find(i => i.id === item.parentId) ?? null : null;
  const children = item.type === 'epic' ? lanesOf(items).find(l => l.epic?.id === item.id)?.items ?? [] : items.filter(i => i.parentId === item.id);
  // Escape closes the panel, unless there is typing that would be lost.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !dirty) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, onClose]);
  const quiet = '-mx-2 w-[calc(100%+1rem)] resize-none rounded-md border-0 bg-transparent px-2 py-1 text-slate-900 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-slate-300 disabled:hover:bg-transparent';
  const prop = 'w-full border-0 bg-transparent p-0 text-sm font-medium text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:ring-0';
  const heading = 'text-[13px] font-semibold text-slate-900';
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/25" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label={item.title} className="flex h-full w-full max-w-[44rem] flex-col bg-white shadow-[-28px_0_56px_-28px_rgba(15,23,42,0.35)]" onClick={e => e.stopPropagation()} data-testid="item-panel">
        <header className="flex items-center gap-2 border-b border-slate-100 px-6 py-3">
          <TypeGlyph type={item.type} />
          <span className="text-sm font-medium text-slate-700">{TYPE[item.type].label}</span>
          {parent && <>
            <span className="text-slate-300" aria-hidden>/</span>
            <button type="button" title={parent.title} onClick={() => onOpen(parent.id)} className="min-w-0 truncate text-sm text-slate-500 hover:text-[#002C4B] hover:underline">{parent.title}</button>
          </>}
          <button type="button" aria-label="Close" onClick={onClose} className="-mr-2 ml-auto shrink-0 rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" aria-hidden><path d="m2.5 2.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 pb-10 pt-5">
          {changes.length > 0 && (
            <div className="mb-5 rounded-lg bg-amber-50 p-3.5 text-sm text-amber-950 ring-1 ring-inset ring-amber-200" data-testid="upstream-changed">
              <p className="font-semibold">Upstream changed: a linked requirement changed after this item was confirmed.</p>
              <p className="mt-0.5 text-xs">This item was not changed. Update it if the work changes.</p>
              {changes.map(c => (
                <div key={c.code} className="mt-2.5 rounded-md bg-white p-2.5 text-xs leading-5">
                  <p className="font-semibold">{c.code}</p>
                  <p className="mt-1 text-red-800 line-through decoration-red-300">{c.before}</p>
                  <p className="mt-0.5 text-emerald-800">{c.after ?? 'The requirement was removed.'}</p>
                </div>
              ))}
            </div>
          )}
          <textarea ref={titleRef} aria-label="Title" rows={1} value={title} disabled={!canEdit} onChange={e => setTitle(e.target.value.replace(/\n/g, ' '))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} className={cx(quiet, 'font-display text-[1.35rem] font-semibold leading-8 tracking-[-0.01em]')} />
          {story !== null && <div className="mt-2 border-l-2 border-[#FFBC03] pl-3.5" data-testid="story-line"><textarea ref={storyRef} aria-label="User story" rows={1} value={line} disabled={!canEdit} onChange={e => setLine(e.target.value.replace(/\n/g, ' '))} className={cx(quiet, 'text-[15px] leading-6 text-slate-700')} /></div>}

          <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-slate-200 ring-1 ring-slate-200 sm:grid-cols-3">
            <label className="grid gap-1 bg-white px-3 py-2 text-[11px] text-slate-500">Status
              <span className="flex items-center gap-1.5"><span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[item.status])} aria-hidden />
                <select aria-label="Status" value={item.status} disabled={!canEdit} onChange={e => onSave({ status: e.target.value as WorkStatus })} className={prop}>{COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
              </span>
            </label>
            <label className="grid gap-1 bg-white px-3 py-2 text-[11px] text-slate-500">Owner
              <select aria-label="Owner" value={item.ownerId ?? ''} disabled={!canEdit} onChange={e => onSave({ ownerId: e.target.value || null })} className={cx(prop, !item.ownerId && 'font-normal text-slate-400')}>
                <option value="">Unassigned</option>
                {members.map(m => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                {item.ownerId && !members.some(m => m.userId === item.ownerId) && <option value={item.ownerId}>Someone no longer in this workspace</option>}
              </select>
            </label>
            <label className="grid gap-1 bg-white px-3 py-2 text-[11px] text-slate-500">Priority
              <select aria-label="Priority" value={item.priority ?? ''} disabled={!canEdit} onChange={e => onSave({ priority: (e.target.value || null) as WorkItem['priority'] })} className={cx(prop, !item.priority && 'font-normal text-slate-400')}><option value="">Not set</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
            </label>
            <label className="grid gap-1 bg-white px-3 py-2 text-[11px] text-slate-500">Estimate (hours)
              <input aria-label="Estimate in hours" inputMode="decimal" value={estimate} disabled={!canEdit} placeholder="Not set" onChange={e => setEstimate(e.target.value)} className={prop} />
            </label>
            <label className="grid gap-1 bg-white px-3 py-2 text-[11px] text-slate-500">Start date
              <input aria-label="Start date" type="date" value={start} disabled={!canEdit} onChange={e => setStart(e.target.value)} className={cx(prop, !start && 'font-normal text-slate-400')} />
            </label>
            <label className="grid gap-1 bg-white px-3 py-2 text-[11px] text-slate-500">Due date
              <input aria-label="Due date" type="date" value={due} disabled={!canEdit} onChange={e => setDue(e.target.value)} className={cx(prop, !due && 'font-normal text-slate-400')} />
            </label>
          </div>

          <h3 className={cx(heading, 'mt-7')}>Description</h3>
          <textarea ref={descRef} aria-label="Description" rows={2} value={description} disabled={!canEdit} placeholder={canEdit ? 'Add what the team needs to know.' : ''} onChange={e => setDescription(e.target.value)} className={cx(quiet, 'mt-1 text-sm leading-6 text-slate-800')} />

          {item.acceptance.length > 0 && <>
            <h3 className={cx(heading, 'mt-7')}>Acceptance criteria</h3>
            <ol className="mt-2 list-decimal space-y-2.5 pl-5 text-sm leading-6 text-slate-700 marker:text-slate-400" data-testid="item-criteria">
              {item.acceptance.map((a, i) => { const parts = criterionParts(a); return <li key={i} className="pl-1">{parts ? parts.map((p, n) => <React.Fragment key={n}>{n > 0 && ', '}<span className="font-semibold text-slate-900">{p.word}</span> {p.text}</React.Fragment>) : a}</li>; })}
            </ol>
          </>}

          {children.length > 0 && <>
            <h3 className={cx(heading, 'mt-7 flex items-center justify-between')}>{item.type === 'epic' ? 'Work in this epic' : 'Work under this item'}<Progress done={children.filter(c => c.status === 'done').length} total={children.length} className="font-normal" /></h3>
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200" data-testid="item-children">
              {children.map(c => (
                <li key={c.id}><button type="button" onClick={() => onOpen(c.id)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <TypeGlyph type={c.type} /><span className="min-w-0 flex-1 truncate text-slate-800">{c.title}</span>{c.ownerId && members.some(m => m.userId === c.ownerId) && <OwnerMark name={members.find(m => m.userId === c.ownerId)!.name} />}<StatusLabel status={c.status} />
                </button></li>
              ))}
            </ul>
          </>}

          {item.requirements.length > 0 && <>
            <h3 className={cx(heading, 'mt-7 flex items-center justify-between')}>Linked requirements<button type="button" className="text-xs font-medium text-[#002C4B] hover:underline" onClick={onOpenFrd}>Open the documents</button></h3>
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg text-sm ring-1 ring-slate-200" data-testid="item-requirements">
              {item.requirements.map(c => { const r = reqs.find(x => x.code === c); return <li key={c} className="flex gap-3 px-3 py-2.5 leading-6"><span className="w-14 shrink-0 text-xs font-semibold leading-6 text-slate-900">{c}</span><span className="text-slate-700">{r ? r.statement : 'Not found in the process any more.'}</span></li>; })}
            </ul>
          </>}

          <p className="mt-8 text-xs text-slate-500">
            {item.stepIds.length > 0 && `Covers ${item.stepIds.length} ${item.stepIds.length === 1 ? 'step' : 'steps'} of the process. `}
            {item.updatedAt && `Last changed ${when(item.updatedAt)}.`}
          </p>
        </div>
        {canEdit && dirty && (
          <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-3">
            <span className="text-sm text-slate-600">You have changes that are not saved.</span>
            <span className="flex gap-2"><Button variant="ghost" onClick={reset}>Discard</Button><Button onClick={() => onSave({ title, description: joinStory(story === null ? null : line.trim() || null, description), estimateHours: estimate.trim() ? Number(estimate) : null, startDate: start || null, dueDate: due || null })}>Save</Button></span>
          </footer>
        )}
      </aside>
    </div>
  );
}
