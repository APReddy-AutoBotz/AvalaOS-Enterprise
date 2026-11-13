// Small shared pieces for the journey screens.
import React from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', className, ...props }: React.ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002C4B] disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-[#002C4B] text-white hover:bg-[#073B60]',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        className,
      )}
    />
  );
}

export function Field({ label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">{label}</label>
      <input id={id} {...props} className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-[#002C4B] focus:ring-2 focus:ring-[#002C4B]/20 focus:outline-none" />
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 p-8 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-[#002C4B]" aria-hidden />
      {label}…
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <h3 className="font-display text-base font-semibold text-slate-900">{title}</h3>
      {children && <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{children}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** Formats an ISO time for people, in their locale. */
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

export const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

// ---- Shared look: one colour and one mark per kind of work, one way to show a tag and progress.
// Every screen uses these, so an epic, a story or a "needs review" reads the same everywhere.
export type WorkType = 'epic' | 'story' | 'task' | 'spike' | 'decision' | 'bug' | 'subtask';
export const WORK_TYPE: Record<WorkType, { label: string; plural: string; cls: string; glyph: React.ReactNode }> = {
  epic: { label: 'Epic', plural: 'Epics', cls: 'bg-violet-600', glyph: <path d="M7 1 3 7h3l-1 4 4-6H6l1-4z" fill="currentColor" /> },
  story: { label: 'Story', plural: 'Stories', cls: 'bg-emerald-600', glyph: <path d="M3.5 2h5v8L6 8.2 3.5 10z" fill="currentColor" /> },
  task: { label: 'Task', plural: 'Tasks', cls: 'bg-blue-600', glyph: <path d="M2.8 6.3 5 8.4l4.2-4.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /> },
  spike: { label: 'Spike', plural: 'Spikes', cls: 'bg-amber-600', glyph: <><circle cx="5.2" cy="5.2" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m7.3 7.3 2.4 2.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></> },
  decision: { label: 'Decision', plural: 'Decisions', cls: 'bg-rose-600', glyph: <path d="M6 10.2V6.6M6 6.6 3 3.2M6 6.6l3-3.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /> },
  bug: { label: 'Bug', plural: 'Bugs', cls: 'bg-red-600', glyph: <circle cx="6" cy="6" r="2.4" fill="currentColor" /> },
  subtask: { label: 'Sub-task', plural: 'Sub-tasks', cls: 'bg-sky-600', glyph: <rect x="3" y="3" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /> },
};
export const TypeGlyph = ({ type }: { type: WorkType }) => (
  <span className={cx('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-white', WORK_TYPE[type].cls)} aria-hidden>
    <svg viewBox="0 0 12 12" className="h-3 w-3">{WORK_TYPE[type].glyph}</svg>
  </span>
);

const TAG = {
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-sky-50 text-sky-800',
  ok: 'bg-emerald-50 text-emerald-800',
  warn: 'bg-amber-100 text-amber-900',
  danger: 'bg-red-50 text-red-800',
} as const;
/** A small state word beside a title: Edited, Needs review, On the board, Working draft. */
export function Tag({ tone = 'neutral', className, ...props }: React.ComponentProps<'span'> & { tone?: keyof typeof TAG }) {
  return <span {...props} className={cx('inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium', TAG[tone], className)} />;
}
/** A requirement code (FR-012), set the same way wherever it appears. */
export const ReqCode = ({ children }: { children: React.ReactNode }) => <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums text-slate-600">{children}</span>;

export const Progress = ({ done, total, className }: { done: number; total: number; className?: string }) => (
  <span className={cx('flex items-center gap-2 whitespace-nowrap text-xs tabular-nums text-slate-500', className)}>
    {done} of {total} done
    <span className="h-1 w-20 overflow-hidden rounded-full bg-slate-200" aria-hidden><span className="block h-full rounded-full bg-emerald-600" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></span>
  </span>
);

/** "3 hours ago", "yesterday", then the date: how recently something changed, at a glance. */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) { const h = Math.round(mins / 60); return `${h} ${h === 1 ? 'hour' : 'hours'} ago`; }
  if (mins < 60 * 48) return 'yesterday';
  if (mins < 60 * 24 * 7) return `${Math.round(mins / 1440)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}
