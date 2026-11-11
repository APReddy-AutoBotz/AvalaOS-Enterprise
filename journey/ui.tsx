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
