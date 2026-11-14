// Sprints on the board, as in Jira's Scrum boards: plan them, start one, complete it. Completing moves
// the unfinished work to a planned sprint or the backlog; done work stays with the completed sprint.
// Rules: domain/workitems/sprints.ts; the database enforces them too (board_collaboration).
import React from 'react';
import type { JourneyStore } from '../store/types.ts';
import { BoardError, type WorkItem } from '../../domain/workitems/board.ts';
import { closeEffect, daysLeft, daysLeftText, moveTargets, nextSprintName, SPRINT_STATE_LABEL, sprintOrder, sprintSummary, startProblem, validateSprint, type Sprint } from '../../domain/workitems/sprints.ts';
import { Button, cx, ErrorNote, messageOf, Progress, Tag } from '../ui.tsx';

const field = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';
const fmt = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : null);
export const sprintDates = (s: Pick<Sprint, 'startsOn' | 'endsOn'>) => (s.startsOn || s.endsOn ? `${fmt(s.startsOn) ?? '…'} – ${fmt(s.endsOn) ?? '…'}` : null);
const today = () => new Date().toISOString().slice(0, 10);
const errorText = (x: unknown) => (x instanceof BoardError ? x.message : messageOf(x));

/** The strip above the board when one sprint is shown: its goal, dates, progress, and Start or Complete. */
export function SprintBar({ sprint, sprints, items, canEdit, onStart, onComplete }: { sprint: Sprint; sprints: Sprint[]; items: WorkItem[]; canEdit: boolean; onStart: () => Promise<void>; onComplete: () => void }) {
  const sum = sprintSummary(sprint, items);
  const left = daysLeftText(daysLeft(sprint, today()));
  const problem = sprint.state === 'planned' ? startProblem(sprint, sprints) : null;
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200" data-testid="sprint-bar">
      <span className="font-semibold text-slate-900">{sprint.name}</span>
      <Tag tone={sprint.state === 'active' ? 'ok' : 'neutral'}>{SPRINT_STATE_LABEL[sprint.state]}</Tag>
      {sprintDates(sprint) && <span className="text-sm text-slate-600">{sprintDates(sprint)}</span>}
      {left && <span className={cx('text-sm', left.startsWith('Ended') ? 'font-medium text-red-700' : 'text-slate-600')}>{left}</span>}
      {sprint.goal && <span className="min-w-0 basis-full text-sm text-slate-700 sm:basis-auto"><span className="text-slate-500">Goal:</span> {sprint.goal}</span>}
      <span className="ml-auto flex items-center gap-3">
        {sum.total > 0 ? <Progress done={sum.done} total={sum.total} /> : <span className="text-sm text-slate-500">No work in this sprint yet</span>}
        {canEdit && sprint.state === 'planned' && <Button variant="secondary" disabled={Boolean(problem)} title={problem ?? undefined} onClick={async () => { setError(null); try { await onStart(); } catch (x) { setError(errorText(x)); } }}>Start sprint</Button>}
        {canEdit && sprint.state === 'active' && <Button variant="secondary" onClick={onComplete}>Complete sprint</Button>}
      </span>
      {problem && canEdit && <p className="basis-full text-xs text-slate-500">{problem}</p>}
      <ErrorNote message={error} />
    </div>
  );
}

/** Complete the running sprint: choose where its unfinished work goes. */
export function CompleteSprintDialog({ sprint, sprints, items, onDone, onClose }: { sprint: Sprint; sprints: Sprint[]; items: WorkItem[]; onDone: (moveTo: string | null) => Promise<void>; onClose: () => void }) {
  const targets = moveTargets(sprint, sprints);
  const [to, setTo] = React.useState(targets[0]?.id ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { open } = sprintSummary(sprint, items);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/25 px-4 py-24" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Complete ${sprint.name}`} onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white p-6 shadow-[0_24px_56px_-20px_rgba(15,23,42,0.45)]" data-testid="complete-sprint">
        <h2 className="font-display text-lg font-semibold text-slate-900">Complete {sprint.name}</h2>
        {open > 0 && (
          <label className="mt-4 block text-sm font-medium text-slate-800">Move the unfinished work to
            <select aria-label="Move the unfinished work to" value={to} onChange={e => setTo(e.target.value)} className={field}>
              {targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value="">The backlog</option>
            </select>
          </label>
        )}
        <p className="mt-4 text-sm leading-6 text-slate-700">{closeEffect(sprint, items, targets.find(t => t.id === to) ?? null)} A completed sprint cannot be started again.</p>
        <ErrorNote message={error} />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await onDone(open ? to || null : null); } catch (x) { setError(errorText(x)); setBusy(false); } }}>{busy ? 'Completing…' : 'Complete sprint'}</Button>
        </div>
      </div>
    </div>
  );
}

/** Every sprint of the board: add one, rename it, set its goal and dates, start or delete it. */
export function SprintsDialog({ store, projectId, sprints, items, canEdit, onChange, onComplete, onShow, onClose }: {
  store: JourneyStore; projectId: string; sprints: Sprint[]; items: WorkItem[]; canEdit: boolean;
  onChange: (next: Sprint[], itemsChanged?: boolean) => void; onComplete: (s: Sprint) => void; onShow: (id: string) => void; onClose: () => void;
}) {
  const [editing, setEditing] = React.useState<{ id: string | null; name: string; goal: string; startsOn: string; endsOn: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose]);
  const run = async (f: () => Promise<void>) => { setError(null); try { await f(); } catch (x) { setError(errorText(x)); } };
  const save = () => run(async () => {
    if (!editing) return;
    const v = validateSprint(editing);
    if (editing.id) { const s = await store.updateSprint(editing.id, v); onChange(sprints.map(x => (x.id === s.id ? s : x))); }
    else onChange([...sprints, await store.createSprint(projectId, v)]);
    setEditing(null);
  });
  const start = (s: Sprint) => run(async () => { const n = await store.updateSprint(s.id, { state: 'active' }); onChange(sprints.map(x => (x.id === n.id ? n : x))); });
  const remove = (s: Sprint) => run(async () => { await store.deleteSprint(s.id); onChange(sprints.filter(x => x.id !== s.id), true); setConfirmDelete(null); });
  const form = editing && (
    <form className="rounded-lg bg-slate-50 p-4" onSubmit={e => { e.preventDefault(); save(); }} data-testid="sprint-form">
      <label className="block text-sm font-medium text-slate-800">Name<input aria-label="Sprint name" autoFocus value={editing.name} maxLength={120} onChange={e => setEditing({ ...editing, name: e.target.value })} className={field} /></label>
      <label className="mt-3 block text-sm font-medium text-slate-800">Goal<textarea aria-label="Sprint goal" rows={2} value={editing.goal} placeholder="What this sprint is for (optional)" onChange={e => setEditing({ ...editing, goal: e.target.value })} className={field} /></label>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-sm font-medium text-slate-800">Starts<input aria-label="Sprint starts" type="date" value={editing.startsOn} onChange={e => setEditing({ ...editing, startsOn: e.target.value })} className={field} /></label>
        <label className="text-sm font-medium text-slate-800">Ends<input aria-label="Sprint ends" type="date" value={editing.endsOn} onChange={e => setEditing({ ...editing, endsOn: e.target.value })} className={field} /></label>
      </div>
      <div className="mt-4 flex gap-2"><Button type="submit">{editing.id ? 'Save' : 'Add sprint'}</Button><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
    </form>
  );
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/25 px-4 py-16" onClick={() => { if (!editing) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Sprints" onClick={e => e.stopPropagation()} className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-[0_24px_56px_-20px_rgba(15,23,42,0.45)]" data-testid="sprints">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-lg font-semibold text-slate-900">Sprints</h2>
          {canEdit && !editing && <Button className="ml-auto" onClick={() => setEditing({ id: null, name: nextSprintName(sprints), goal: '', startsOn: '', endsOn: '' })}>New sprint</Button>}
          <button type="button" aria-label="Close" onClick={onClose} className={cx('rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900', (!canEdit || editing) && 'ml-auto')}>
            <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" aria-hidden><path d="m2.5 2.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <p className="mt-1 text-sm leading-6 text-slate-600">Plan work in time boxes. One sprint runs at a time; completing it moves its unfinished work on. Put an item in a sprint from its panel.</p>
        <ErrorNote message={error} />
        {editing && !editing.id && <div className="mt-4">{form}</div>}
        {!sprints.length && !editing && <p className="mt-6 text-sm text-slate-500">{canEdit ? 'No sprints yet. Add one with New sprint.' : 'No sprints yet.'}</p>}
        <ul className="mt-4 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
          {sprintOrder(sprints).map(s => {
            const sum = sprintSummary(s, items);
            const problem = startProblem(s, sprints);
            if (editing?.id === s.id) return <li key={s.id} className="p-3">{form}</li>;
            return (
              <li key={s.id} className="px-4 py-3" data-testid="sprint-row">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button type="button" onClick={() => onShow(s.id)} className="font-medium text-slate-900 hover:text-[#002C4B] hover:underline">{s.name}</button>
                  <Tag tone={s.state === 'active' ? 'ok' : 'neutral'}>{SPRINT_STATE_LABEL[s.state]}</Tag>
                  {sprintDates(s) && <span className="text-xs text-slate-600">{sprintDates(s)}</span>}
                  <span className="ml-auto text-xs tabular-nums text-slate-600">{sum.total ? `${sum.done} of ${sum.total} done` : 'No work yet'}</span>
                </div>
                {s.goal && <p className="mt-1 text-sm text-slate-700">{s.goal}</p>}
                {canEdit && s.state !== 'closed' && (
                  confirmDelete === s.id ? (
                    <div role="alertdialog" aria-label={`Delete ${s.name}`} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-950 ring-1 ring-inset ring-red-200">
                      Delete {s.name}? {sum.total ? `Its ${sum.total} ${sum.total === 1 ? 'item goes' : 'items go'} back to the backlog.` : ''}
                      <button type="button" onClick={() => remove(s)} className="rounded-md bg-red-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-800">Delete</button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="text-xs font-medium text-slate-700 hover:underline">Keep it</button>
                    </div>
                  ) : (
                    <p className="mt-1.5 flex flex-wrap gap-3 text-xs font-medium">
                      {s.state === 'planned' && <button type="button" disabled={Boolean(problem)} title={problem ?? undefined} onClick={() => start(s)} className="text-[#002C4B] hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline">Start</button>}
                      {s.state === 'active' && <button type="button" onClick={() => onComplete(s)} className="text-[#002C4B] hover:underline">Complete</button>}
                      <button type="button" onClick={() => setEditing({ id: s.id, name: s.name, goal: s.goal, startsOn: s.startsOn ?? '', endsOn: s.endsOn ?? '' })} className="text-slate-600 hover:underline">Edit</button>
                      <button type="button" onClick={() => setConfirmDelete(s.id)} className="text-slate-600 hover:text-red-700 hover:underline">Delete</button>
                    </p>
                  )
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
