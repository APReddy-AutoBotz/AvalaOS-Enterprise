// Review comments on a document section (part F, with G's review comments). Every member comments,
// viewers too; the author changes the text; the author or an editor resolves; the author or an admin
// deletes. The database enforces the same rules (document_comments). Rules: domain/docs/review.ts.
import React from 'react';
import type { JourneyStore, Member } from '../store/types.ts';
import { commentRights, ReviewError, validateSectionComment, type SectionComment } from '../../domain/docs/review.ts';
import type { DocType } from '../../domain/docs/tree.ts';
import { ago, Button, cx, messageOf } from '../ui.tsx';

const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';

export interface ReviewContext {
  store: JourneyStore; processId: string; me: string; canEdit: boolean; isAdmin: boolean; members: Member[];
  onChanged: (next: SectionComment[] | ((cur: SectionComment[]) => SectionComment[])) => void;
}

/** The "Comment" button in a section's heading, with the number of open comments. */
export function CommentButton({ open, count, onClick, number }: { open: boolean; count: number; onClick: () => void; number: string }) {
  return (
    <button type="button" className={cx('no-print font-sans text-xs font-medium hover:underline', count ? 'text-amber-800' : 'text-slate-500 hover:text-[#002C4B]')} aria-expanded={open}
      aria-label={count ? `${count} open ${count === 1 ? 'comment' : 'comments'} on section ${number}` : `Comment on section ${number}`} onClick={onClick} data-testid="comment-button">
      {count ? `${count} ${count === 1 ? 'comment' : 'comments'}` : 'Comment'}
    </button>
  );
}

export function SectionComments({ ctx, docType, sectionKey, sectionTitle, comments, startOpen }: { ctx: ReviewContext; docType: DocType; sectionKey: string; sectionTitle: string; comments: SectionComment[]; startOpen: boolean }) {
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [showResolved, setShowResolved] = React.useState(false);
  const name = (id: string | null) => (id ? (id === ctx.me ? 'You' : ctx.members.find(m => m.userId === id)?.name ?? 'A former member') : 'A former member');
  const run = async (f: () => Promise<void>) => { setBusy(true); setError(null); try { await f(); } catch (e) { setError(e instanceof ReviewError ? e.message : messageOf(e)); } finally { setBusy(false); } };
  const replace = (c: SectionComment) => ctx.onChanged(cur => cur.map(x => (x.id === c.id ? c : x)));
  const shown = comments.filter(c => showResolved || !c.resolvedAt);
  const resolved = comments.filter(c => c.resolvedAt).length;
  if (!startOpen && !comments.some(c => !c.resolvedAt)) return null;

  return (
    <div className="no-print mt-3 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200" data-testid="section-comments" aria-label={`Comments on ${sectionTitle}`}>
      <ul className="space-y-3">
        {shown.map(c => {
          const may = commentRights(c, { id: ctx.me, canEdit: ctx.canEdit, isAdmin: ctx.isAdmin });
          return (
            <li key={c.id} className={cx('rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-slate-200', c.resolvedAt && 'opacity-75')} data-testid="section-comment" data-resolved={c.resolvedAt ? 'yes' : 'no'}>
              <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-900">{name(c.authorId)}</span>
                <span>{ago(c.createdAt)}{c.editedAt ? ' · edited' : ''}</span>
                {c.resolvedAt && <span className="text-emerald-800">Resolved by {name(c.resolvedBy)}</span>}
              </p>
              {editing === c.id ? (
                <div className="mt-2 space-y-2">
                  <textarea className={input} rows={3} aria-label="Change your comment" value={draft} onChange={e => setDraft(e.target.value)} />
                  <div className="flex gap-2">
                    <Button disabled={busy} onClick={() => run(async () => { replace(await ctx.store.editSectionComment(c.id, validateSectionComment(draft))); setEditing(null); })}>Save</Button>
                    <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </div>
              ) : <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{c.body}</p>}
              {editing !== c.id && (may.edit || may.resolve || may.remove) && (
                <p className="mt-1.5 flex flex-wrap gap-3 text-xs font-medium">
                  {may.resolve && <button type="button" className="text-[#002C4B] hover:underline" disabled={busy} onClick={() => run(async () => replace(await ctx.store.resolveSectionComment(c.id, !c.resolvedAt)))}>{c.resolvedAt ? 'Reopen' : 'Resolve'}</button>}
                  {may.edit && !c.resolvedAt && <button type="button" className="text-slate-600 hover:underline" onClick={() => { setEditing(c.id); setDraft(c.body); }}>Change</button>}
                  {may.remove && <button type="button" className="text-slate-600 hover:underline" disabled={busy} onClick={() => run(async () => { await ctx.store.deleteSectionComment(c.id); ctx.onChanged(cur => cur.filter(x => x.id !== c.id)); })}>Delete</button>}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {resolved > 0 && <button type="button" className="mt-2 text-xs font-medium text-slate-600 hover:underline" onClick={() => setShowResolved(!showResolved)}>{showResolved ? 'Hide resolved' : `Show ${resolved} resolved`}</button>}
      <div className={cx('space-y-2', shown.length || resolved ? 'mt-3' : '')}>
        <textarea className={input} rows={2} aria-label={`Comment on ${sectionTitle}`} placeholder="What should change here, or what is missing?" value={text} onChange={e => setText(e.target.value)} />
        {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
        <Button variant="secondary" disabled={busy || !text.trim()} onClick={() => run(async () => {
          const c = await ctx.store.addSectionComment(ctx.processId, { docType, sectionKey, sectionTitle, body: validateSectionComment(text) });
          ctx.onChanged(cur => [...cur, c]); setText('');
        })}>Add comment</Button>
      </div>
    </div>
  );
}
