// The Delivery board: confirmed work items by status, in one project. Cards move between columns
// (drag, or the status in the detail panel); every change is saved at once. The detail panel shows
// the acceptance criteria and the linked requirements, and warns when a requirement changed after
// the item was confirmed; the item itself is never changed for you.
import React from 'react';
import type { JourneyStore, Workspace } from '../store/types.ts';
import type { Nav } from '../JourneyApp.tsx';
import { BoardError, COLUMNS, planningLine, STATUS_LABEL, upstreamChanges, validateEdit, validateProjectName, type Project, type WorkItem, type WorkItemEdit, type WorkStatus } from '../../domain/workitems/board.ts';
import type { StoredRequirement } from '../../domain/requirements/register.ts';
import { Button, cx, ErrorNote, messageOf, Spinner } from '../ui.tsx';

const WORKSPACE_KEY = 'avala.journey.workspace';
const remembered = () => { try { return localStorage.getItem(WORKSPACE_KEY); } catch { return null; } };
const MAIN: WorkStatus[] = ['todo', 'in_progress', 'in_review', 'testing', 'ready_for_release', 'done'];
const TYPE_CLS: Record<string, string> = { epic: 'bg-violet-50 text-violet-800', story: 'bg-sky-50 text-sky-800', task: 'bg-slate-100 text-slate-700', spike: 'bg-amber-50 text-amber-900', decision: 'bg-rose-50 text-rose-800', bug: 'bg-red-50 text-red-800', subtask: 'bg-slate-100 text-slate-700' };
const input = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';

export function BoardPage({ store, nav, projectId, itemId }: { store: JourneyStore; nav: Nav; projectId?: string; itemId?: string }) {
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null);
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  const [items, setItems] = React.useState<WorkItem[] | null>(null);
  const [reqs, setReqs] = React.useState<Record<string, StoredRequirement[]>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [newName, setNewName] = React.useState('');
  const [dragging, setDragging] = React.useState<string | null>(null);

  React.useEffect(() => {
    store.listWorkspaces().then(async list => {
      const w = list.find(x => x.id === remembered()) ?? list[0] ?? null;
      setWorkspace(w);
      setProjects(w ? await store.listProjects(w.id) : []);
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
      setProjects(cur => [...(cur ?? []), p]); setNewName('');
      nav.go({ page: 'board', projectId: p.id });
    } catch (x) { setError(x instanceof BoardError ? x.message : messageOf(x)); }
  };

  if (!projects) return error ? <ErrorNote message={error} /> : <Spinner />;
  const canEdit = workspace?.role !== 'viewer';
  const open = items?.find(i => i.id === itemId) ?? null;
  const changesOf = (i: WorkItem) => (i.processId ? upstreamChanges(i, (reqs[i.processId] ?? []).map(r => ({ code: r.code, statement: r.statement, state: r.state }))) : []);

  return (
    <section className="space-y-5" data-testid="board">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">Delivery board</h1>
          <p className="mt-1 text-sm text-slate-600">Work items confirmed from your processes. Owner, estimate and dates stay empty until your team sets them.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {projects.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-600">Project
              <select aria-label="Project" value={projectId ?? ''} onChange={e => nav.go({ page: 'board', projectId: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm">
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          {canEdit && <span className="flex items-center gap-2"><input aria-label="New project name" placeholder="New project" value={newName} onChange={e => setNewName(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" /><Button variant="secondary" onClick={create}>Add project</Button></span>}
        </div>
      </div>
      <ErrorNote message={error} />
      {!projects.length && <p className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-600">No projects yet. Add one here, or confirm work items from a process's Work items stage.</p>}
      {project && !items && <Spinner />}
      {project && items && (
        <>
          <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-3 xl:grid-cols-6" role="list" aria-label="Columns">
            {MAIN.map(status => {
              const col = items.filter(i => i.status === status);
              return (
                <div key={status} role="listitem" aria-label={STATUS_LABEL[status]} data-testid={`column-${status}`}
                  onDragOver={e => { if (canEdit) e.preventDefault(); }}
                  onDrop={e => { e.preventDefault(); const it = items.find(i => i.id === dragging); if (it && it.status !== status) update(it, { status }); setDragging(null); }}
                  className={cx('min-h-[12rem] rounded-2xl bg-slate-100/70 p-2.5', dragging && 'ring-2 ring-dashed ring-slate-300')}>
                  <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wider text-slate-600">{STATUS_LABEL[status]}<span className="rounded-full bg-white px-2 py-0.5 text-slate-500">{col.length}</span></h2>
                  <ul className="space-y-2">
                    {col.map(i => {
                      const changed = changesOf(i).length > 0;
                      return (
                        <li key={i.id} draggable={canEdit} onDragStart={() => setDragging(i.id)} onDragEnd={() => setDragging(null)} data-testid="board-card">
                          <button type="button" onClick={() => nav.go({ page: 'board', projectId: project.id, itemId: i.id })} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-[#002C4B]/40">
                            <span className="flex items-center gap-1.5"><span className={cx('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', TYPE_CLS[i.type])}>{i.type}</span>{changed && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">Upstream changed</span>}</span>
                            <span className="mt-1.5 block text-sm font-semibold leading-5 text-slate-900">{i.title}</span>
                            <span className="mt-1 flex flex-wrap gap-1">{i.requirements.slice(0, 3).map(c => <span key={c} className="rounded bg-slate-100 px-1 font-mono text-[10px] font-semibold text-slate-600">{c}</span>)}</span>
                            <span className="mt-1.5 block text-[11px] text-slate-500">{planningLine(i)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
          {items.some(i => i.status === 'blocked' || i.status === 'on_hold') && (
            <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm" data-testid="blocked">
              <span className="font-semibold text-slate-700">Blocked or on hold: </span>
              {items.filter(i => i.status === 'blocked' || i.status === 'on_hold').map(i => <button key={i.id} className="mr-3 text-[#002C4B] hover:underline" onClick={() => nav.go({ page: 'board', projectId: project.id, itemId: i.id })}>{i.title} ({STATUS_LABEL[i.status]})</button>)}
            </div>
          )}
          {!items.length && <p className="text-center text-sm text-slate-600">No items in this project yet. Confirm work items from a process's Work items stage.</p>}
        </>
      )}
      {open && project && <React.Fragment key={open.id}><ItemPanel item={open} canEdit={canEdit} reqs={open.processId ? reqs[open.processId] ?? [] : []} changes={changesOf(open)} onClose={() => nav.go({ page: 'board', projectId: project.id })} onSave={e => update(open, e)} onOpenFrd={() => { if (open.processId) nav.go({ page: 'process', processId: open.processId, stage: 'documents' }); }} /></React.Fragment>}
    </section>
  );
}

function ItemPanel({ item, canEdit, reqs, changes, onClose, onSave, onOpenFrd }: { item: WorkItem; canEdit: boolean; reqs: StoredRequirement[]; changes: ReturnType<typeof upstreamChanges>; onClose: () => void; onSave: (e: WorkItemEdit) => Promise<void>; onOpenFrd: () => void }) {
  const [title, setTitle] = React.useState(item.title);
  const [description, setDescription] = React.useState(item.description);
  const [estimate, setEstimate] = React.useState(item.estimateHours === null ? '' : String(item.estimateHours));
  const [due, setDue] = React.useState(item.dueDate ?? '');
  const dirty = title !== item.title || description !== item.description || estimate !== (item.estimateHours === null ? '' : String(item.estimateHours)) || due !== (item.dueDate ?? '');
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20" onClick={onClose}>
      <aside role="dialog" aria-label={item.title} className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()} data-testid="item-panel">
        <div className="flex items-start justify-between gap-3">
          <span className={cx('rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase', TYPE_CLS[item.type])}>{item.type}</span>
          <button type="button" className="text-sm text-slate-600 hover:underline" onClick={onClose}>Close</button>
        </div>
        {changes.length > 0 && (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-inset ring-amber-200" data-testid="upstream-changed">
            <p className="font-semibold">Upstream changed: a linked requirement changed after this item was confirmed.</p>
            <p className="mt-0.5 text-xs">This item was not changed. Update it if the work changes.</p>
            {changes.map(c => (
              <div key={c.code} className="mt-2 rounded-lg bg-white p-2 text-xs">
                <p className="font-mono font-semibold">{c.code}</p>
                <p className="mt-1 text-red-800 line-through decoration-red-300">{c.before}</p>
                <p className="mt-0.5 text-emerald-800">{c.after ?? 'The requirement was removed.'}</p>
              </div>
            ))}
          </div>
        )}
        <label className="mt-4 grid gap-1 text-xs font-semibold text-slate-700">Title<input aria-label="Title" value={title} disabled={!canEdit} onChange={e => setTitle(e.target.value)} className={input} /></label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-xs font-semibold text-slate-700">Status
            <select aria-label="Status" value={item.status} disabled={!canEdit} onChange={e => onSave({ status: e.target.value as WorkStatus })} className={input}>{COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">Priority
            <select aria-label="Priority" value={item.priority ?? ''} disabled={!canEdit} onChange={e => onSave({ priority: (e.target.value || null) as WorkItem['priority'] })} className={input}><option value="">Not set</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">Estimate (hours)<input aria-label="Estimate in hours" inputMode="decimal" value={estimate} disabled={!canEdit} placeholder="Not estimated" onChange={e => setEstimate(e.target.value)} className={input} /></label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">Due date<input aria-label="Due date" type="date" value={due} disabled={!canEdit} onChange={e => setDue(e.target.value)} className={input} /></label>
        </div>
        <label className="mt-3 grid gap-1 text-xs font-semibold text-slate-700">Description<textarea aria-label="Description" value={description} disabled={!canEdit} rows={Math.min(12, description.split('\n').length + 2)} onChange={e => setDescription(e.target.value)} className={cx(input, 'font-normal')} /></label>
        {canEdit && dirty && <div className="mt-3"><Button onClick={() => onSave({ title, description, estimateHours: estimate.trim() ? Number(estimate) : null, dueDate: due || null })}>Save</Button></div>}
        <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">Acceptance criteria</h3>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-slate-800" data-testid="item-criteria">{item.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ol>
        {item.requirements.length > 0 && <>
          <h3 className="mt-6 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500">Linked requirements<button type="button" className="normal-case tracking-normal text-[#002C4B] hover:underline" onClick={onOpenFrd}>Open the documents</button></h3>
          <ul className="mt-2 space-y-2 text-sm" data-testid="item-requirements">
            {item.requirements.map(c => { const r = reqs.find(x => x.code === c); return <li key={c} className="rounded-lg bg-slate-50 px-3 py-2"><span className="font-mono text-xs font-semibold text-slate-700">{c}</span> <span className="text-slate-800">{r ? r.statement : 'Not found in the process any more.'}</span></li>; })}
          </ul>
        </>}
        <p className="mt-6 text-xs text-slate-500">{planningLine(item)}{item.stepIds.length ? ` · ${item.stepIds.length} ${item.stepIds.length === 1 ? 'step' : 'steps'} of the process` : ''}</p>
      </aside>
    </div>
  );
}
