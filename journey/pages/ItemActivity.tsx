// The bottom of a board item, as in Jira: Comments and History. Every member comments (viewers too);
// only the author edits a comment; the author or an admin deletes one. History is written by the
// database (board_collaboration) and read here in plain words (describeEvent).
import React from 'react';
import type { JourneyStore, Member } from '../store/types.ts';
import { BoardError, type WorkItem } from '../../domain/workitems/board.ts';
import { commentRights, COMMENT_LIMIT, describeEvent, historyOrder, validateComment, type HistoryNames, type ItemComment, type ItemEvent } from '../../domain/workitems/collab.ts';
import { ago, Button, cx, ErrorNote, messageOf, Spinner, when } from '../ui.tsx';

const box = 'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';

export function ItemActivity({ store, item, items, members, me, isAdmin, sprintName, onDirty }: {
  store: JourneyStore; item: WorkItem; items: WorkItem[]; members: Member[]; me: string; isAdmin: boolean;
  sprintName?: (id: string) => string | undefined;
  /** True while a comment is being written, so Escape does not close the panel and lose it. */
  onDirty: (dirty: boolean) => void;
}) {
  const [tab, setTab] = React.useState<'comments' | 'history'>('comments');
  const [comments, setComments] = React.useState<ItemComment[] | null>(null);
  const [events, setEvents] = React.useState<ItemEvent[] | null>(null);
  const [draft, setDraft] = React.useState('');
  const [editing, setEditing] = React.useState<{ id: string; body: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => { store.listComments(item.id).then(setComments).catch(e => setError(messageOf(e))); }, [store, item.id]);
  // The history follows every saved change to the item.
  React.useEffect(() => { if (tab === 'history') store.listItemHistory(item.id).then(setEvents).catch(e => setError(messageOf(e))); }, [store, item.id, item.updatedAt, tab]);
  React.useEffect(() => { onDirty(Boolean(draft.trim() || editing)); }, [draft, editing, onDirty]);

  const name = (id: string | null) => (id ? members.find(m => m.userId === id)?.name ?? 'A former member' : 'A former member');
  const names: HistoryNames = {
    person: id => members.find(m => m.userId === id)?.name,
    item: id => items.find(i => i.id === id),
    sprint: id => sprintName?.(id),
  };
  const run = async (f: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await f(); } catch (x) { setError(x instanceof BoardError ? x.message : messageOf(x)); } finally { setBusy(false); }
  };
  const add = () => run(async () => {
    const c = await store.addComment(item.id, validateComment(draft));
    setComments(cur => [...(cur ?? []), c]); setDraft('');
  });
  const saveEdit = () => run(async () => {
    if (!editing) return;
    const c = await store.editComment(editing.id, validateComment(editing.body));
    setComments(cur => (cur ?? []).map(x => (x.id === c.id ? c : x))); setEditing(null);
  });
  const remove = (id: string) => run(async () => {
    await store.deleteComment(id);
    setComments(cur => (cur ?? []).filter(x => x.id !== id)); setConfirmDelete(null);
  });
  const submitKeys = (e: React.KeyboardEvent, f: () => void) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); f(); } };
  const tabCls = (on: boolean) => cx('-mb-px border-b-2 px-1 pb-2 text-sm font-medium', on ? 'border-[#002C4B] text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800');

  return (
    <section className="mt-8" aria-label="Activity" data-testid="item-activity">
      <div role="tablist" aria-label="Activity" className="flex gap-5 border-b border-slate-200">
        <button type="button" role="tab" aria-selected={tab === 'comments'} onClick={() => setTab('comments')} className={tabCls(tab === 'comments')}>
          Comments{comments && comments.length > 0 && <span className="ml-1.5 tabular-nums text-slate-500">{comments.length}</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')} className={tabCls(tab === 'history')}>History</button>
      </div>
      <ErrorNote message={error} />

      {tab === 'comments' && (
        <div role="tabpanel" aria-label="Comments" className="pt-4">
          <label className="sr-only" htmlFor={`comment-${item.id}`}>Add a comment</label>
          <textarea id={`comment-${item.id}`} rows={draft ? 3 : 1} value={draft} maxLength={COMMENT_LIMIT} placeholder="Add a comment…" onChange={e => setDraft(e.target.value)} onKeyDown={e => submitKeys(e, add)} className={box} />
          {draft.trim() && (
            <div className="mt-2 flex items-center gap-2">
              <Button onClick={add} disabled={busy}>{busy ? 'Saving…' : 'Comment'}</Button>
              <Button variant="ghost" onClick={() => setDraft('')}>Cancel</Button>
              <span className="ml-auto text-xs text-slate-500">Ctrl + Enter to send</span>
            </div>
          )}
          {!comments ? <Spinner /> : !comments.length ? <p className="mt-4 text-sm text-slate-500">No comments yet.</p> : (
            <ul className="mt-5 space-y-5" data-testid="comments">
              {comments.map(c => {
                const rights = commentRights(c, me, isAdmin);
                return (
                  <li key={c.id} data-testid="comment">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-semibold text-slate-900">{name(c.authorId)}</span>
                      <span className="text-xs text-slate-500" title={when(c.createdAt)}>{ago(c.createdAt)}</span>
                      {c.editedAt && <span className="text-xs text-slate-500" title={when(c.editedAt)}>(edited)</span>}
                    </p>
                    {editing?.id === c.id ? (
                      <div className="mt-1.5">
                        <textarea aria-label="Edit comment" rows={3} value={editing.body} maxLength={COMMENT_LIMIT} autoFocus onChange={e => setEditing({ id: c.id, body: e.target.value })} onKeyDown={e => submitKeys(e, saveEdit)} className={box} />
                        <div className="mt-2 flex gap-2"><Button onClick={saveEdit} disabled={busy}>Save</Button><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
                      </div>
                    ) : <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{c.body}</p>}
                    {(rights.edit || rights.remove) && editing?.id !== c.id && (
                      confirmDelete === c.id ? (
                        <div role="alertdialog" aria-label="Delete this comment" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-950 ring-1 ring-inset ring-red-200">
                          Delete this comment? This cannot be undone.
                          <button type="button" onClick={() => remove(c.id)} className="rounded-md bg-red-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-800">Delete</button>
                          <button type="button" onClick={() => setConfirmDelete(null)} className="text-xs font-medium text-slate-700 hover:underline">Keep it</button>
                        </div>
                      ) : (
                        <p className="mt-1 flex gap-3 text-xs font-medium">
                          {rights.edit && <button type="button" onClick={() => setEditing({ id: c.id, body: c.body })} className="text-slate-600 hover:text-[#002C4B] hover:underline">Edit</button>}
                          {rights.remove && <button type="button" onClick={() => setConfirmDelete(c.id)} className="text-slate-600 hover:text-red-700 hover:underline">Delete</button>}
                        </p>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div role="tabpanel" aria-label="History" className="pt-4">
          {!events ? <Spinner /> : !events.length ? <p className="text-sm text-slate-500">No changes recorded yet. History is kept from 14 November 2026.</p> : (
            <ol className="space-y-2.5 text-sm" data-testid="item-history">
              {historyOrder(events).map(e => { const d = describeEvent(e, names); return (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 leading-6">
                  <span><span className="font-semibold text-slate-900">{d.who}</span> <span className="text-slate-700">{d.text}</span></span>
                  <span className="text-xs text-slate-500" title={when(e.createdAt)}>{ago(e.createdAt)}</span>
                </li>
              ); })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

/** Labels as chips; editors add (Enter, space or comma) and remove them. Suggestions are the board's labels. */
export function LabelsField({ labels, suggestions, canEdit, onSave }: { labels: string[]; suggestions: string[]; canEdit: boolean; onSave: (labels: string[]) => Promise<void> }) {
  const [text, setText] = React.useState('');
  const listId = React.useId();
  const add = async () => { if (text.trim()) { await onSave([...labels, text]); setText(''); } };
  if (!canEdit && !labels.length) return null;
  return (
    <div className="mt-5" data-testid="item-labels">
      <h3 className="text-[13px] font-semibold text-slate-900">Labels</h3>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {labels.map(l => (
          <span key={l} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700" data-testid="label">
            {l}
            {canEdit && <button type="button" aria-label={`Remove label ${l}`} onClick={() => onSave(labels.filter(x => x !== l))} className="-mr-0.5 rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900">
              <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden><path d="m3 3 6 6m0-6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>}
          </span>
        ))}
        {canEdit && <>
          <input aria-label="Add a label" list={listId} value={text} placeholder={labels.length ? 'Add' : 'Add a label'} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',' || e.key === ' ') { e.preventDefault(); add(); } }} onBlur={add}
            className="w-28 rounded-md border border-transparent px-2 py-0.5 text-xs text-slate-900 placeholder:text-slate-400 hover:border-slate-200 focus:border-slate-300 focus:outline-none" />
          <datalist id={listId}>{suggestions.filter(s => !labels.includes(s)).map(s => <option key={s} value={s} />)}</datalist>
        </>}
      </div>
    </div>
  );
}
