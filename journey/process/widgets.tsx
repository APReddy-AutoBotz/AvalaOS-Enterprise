// Small editing controls for the Process stage.
import React from 'react';
import type { FactStatus, SourceLocator, SourceRef } from '../../domain/processModel/types.ts';
import { cx } from '../ui.tsx';

const STATUS: Record<FactStatus, { label: string; tone: string; title: string }> = {
  stated: { label: 'From sources', tone: 'border-sky-200 bg-sky-50 text-sky-800', title: 'Said or written in a source' },
  inferred: { label: 'Inferred', tone: 'border-violet-200 bg-violet-50 text-violet-800', title: 'Read from the sources but not said outright; check it' },
  'user-confirmed': { label: 'Confirmed', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', title: 'Set or confirmed by a person' },
  assumed: { label: 'Assumption', tone: 'border-amber-300 bg-amber-50 text-amber-900', title: 'A working assumption to confirm' },
  unknown: { label: 'Unknown', tone: 'border-slate-300 bg-slate-100 text-slate-700', title: 'Known to be missing' },
};

export function StatusBadge({ status }: { status: FactStatus }) {
  const s = STATUS[status];
  return <span title={s.title} data-status={status} className={cx('inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold', s.tone)}>{s.label}</span>;
}

/** A text value edited in place: saved on Enter or when focus leaves, reverted on Escape. */
export function InlineText({ value, onSave, label, multiline, placeholder, disabled, className }: {
  value: string; onSave: (v: string) => void; label: string; multiline?: boolean; placeholder?: string; disabled?: boolean; className?: string;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  const commit = () => { const v = draft.trim(); if (v !== value.trim()) { if (v) onSave(v); else setDraft(value); } };
  const common = {
    'aria-label': label,
    value: draft,
    disabled,
    placeholder,
    onBlur: commit,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    className: cx('w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-slate-900 hover:border-slate-300 focus:border-[#002C4B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20 disabled:hover:border-transparent', className),
  };
  if (multiline) {
    return <textarea {...common} rows={3} onKeyDown={e => { if (e.key === 'Escape') setDraft(value); }} />;
  }
  return <input {...common} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setDraft(value); }} />;
}

export function Select<T extends string>({ value, options, onChange, label, disabled, className }: {
  value: T | ''; options: { value: T | ''; label: string }[]; onChange: (v: T) => void; label: string; disabled?: boolean; className?: string;
}) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value as T)}
      className={cx('rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20 disabled:bg-slate-50', className)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** A set of references (roles or systems) shown as chips, with a picker to add one. */
export function RefChips({ ids, options, onChange, label, disabled }: {
  ids: string[]; options: { id: string; name: string }[]; onChange: (ids: string[]) => void; label: string; disabled?: boolean;
}) {
  const name = (id: string) => options.find(o => o.id === id)?.name ?? id;
  const rest = options.filter(o => !ids.includes(o.id));
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      {ids.map(id => (
        <span key={id} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
          {name(id)}
          {!disabled && <button type="button" aria-label={`Remove ${name(id)} from ${label.toLowerCase()}`} onClick={() => onChange(ids.filter(x => x !== id))} className="text-slate-500 hover:text-red-700">×</button>}
        </span>
      ))}
      {ids.length === 0 && <span className="text-xs italic text-slate-400">None</span>}
      {!disabled && rest.length > 0 && (
        <select aria-label={`Add to ${label.toLowerCase()}`} value="" onChange={e => e.target.value && onChange([...ids, e.target.value])}
          className="rounded-md border border-dashed border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-600">
          <option value="">+ Add</option>
          {rest.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
    </div>
  );
}

/** A delete button that asks once more inline instead of opening a browser dialog. */
export function ConfirmDelete({ what, onDelete, disabled }: { what: string; onDelete: () => void; disabled?: boolean }) {
  const [asking, setAsking] = React.useState(false);
  if (disabled) return null;
  if (!asking) return <button type="button" aria-label={`Delete ${what}`} onClick={() => setAsking(true)} className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-red-50 hover:text-red-700">Delete</button>;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <button type="button" onClick={() => { setAsking(false); onDelete(); }} className="rounded bg-red-600 px-1.5 py-0.5 font-semibold text-white hover:bg-red-700">Delete {what}?</button>
      <button type="button" onClick={() => setAsking(false)} className="rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-100">Keep</button>
    </span>
  );
}

export function locatorText(l: SourceLocator): string {
  const parts: string[] = [];
  if (l.section) parts.push(`§${l.section}`);
  if (l.heading) parts.push(l.heading);
  if (l.page) parts.push(`page ${l.page}${l.lineStart ? `, line ${l.lineStart}` : ''}`);
  else if (l.lineStart) parts.push(`line ${l.lineStart}`);
  if (l.timestamp) parts.push(l.timestamp);
  if (l.speaker) parts.push(l.speaker);
  if (l.cell) parts.push(l.cell);
  if (l.shapeId && !l.speaker) parts.push('flowchart shape');
  return parts.join(' · ');
}

/** The sources behind an element: where each quote comes from, and the quote. */
export function SourceList({ sources, sourceTitle }: { sources: SourceRef[]; sourceTitle: (id: string) => string }) {
  if (sources.length === 0) return <p className="text-sm text-slate-500">No source: this was entered or confirmed by a person.</p>;
  return (
    <ul className="space-y-3">
      {sources.map((s, i) => (
        <li key={i} className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold text-slate-700">{sourceTitle(s.sourceId)}</p>
          {locatorText(s.locator) && <p className="text-xs text-slate-500">{locatorText(s.locator)}</p>}
          <blockquote className="mt-2 border-l-2 border-[#FFBC03] pl-3 text-sm leading-6 text-slate-800">{s.excerpt}</blockquote>
        </li>
      ))}
    </ul>
  );
}

export function SourcesButton({ count, onClick, what }: { count: number; onClick: () => void; what: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={`Sources for ${what}`} className="rounded px-1.5 py-0.5 text-xs font-medium text-[#002C4B] hover:bg-slate-100">
      {count === 0 ? 'No source' : `${count} source${count === 1 ? '' : 's'}`}
    </button>
  );
}

/** A side panel for details and sources. */
export function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20" onClick={onClose}>
      <aside role="dialog" aria-label={title} className="h-full w-full max-w-md overflow-y-auto bg-slate-50 p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded px-2 text-lg text-slate-500 hover:bg-slate-200">×</button>
        </div>
        <div className="mt-4 space-y-4">{children}</div>
      </aside>
    </div>
  );
}

export function TableShell({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>{head.map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}
