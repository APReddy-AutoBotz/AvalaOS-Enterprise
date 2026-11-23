// The confirmation of approving a new version (package 14, part F): from version 2 on, what changed since the
// version before, and the reason, required. A native modal dialog: Escape closes it, the page behind cannot be
// reached while it is open.
import React from 'react';
import { changeLines, reasonHelp, reasonProblem, REASON_LABEL } from '../../domain/docs/versions.ts';
import type { PreparedApproval } from './keepVersion.ts';
import { Button } from '../ui.tsx';

export function ApproveDialog({ prepared, busy, error, onApprove, onClose }: {
  prepared: PreparedApproval; busy: boolean; error: string | null;
  onApprove: (reason: string) => void; onClose: () => void;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const [reason, setReason] = React.useState('');
  const [tried, setTried] = React.useState(false);
  React.useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal?.(); }, []);
  const N = prepared.number;
  const problem = reasonProblem(N, reason);
  const lines = changeLines(prepared.changes);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="approve-h" data-testid="approve-dialog"
      className="w-[min(40rem,calc(100vw-2rem))] rounded-2xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-[#001B2F]/70">
      <form className="max-h-[calc(100vh-2rem)] overflow-y-auto p-6" onSubmit={e => { e.preventDefault(); setTried(true); if (!problem) onApprove(reason); }}>
        <div className="flex items-start justify-between gap-4">
          <h2 id="approve-h" className="font-display text-2xl font-semibold tracking-tight">Approve version {N}</h2>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-600">Approving keeps every document of this process exactly as it reads now, as version {N}. Approved version {N - 1} stays as it was.</p>
        <section className="mt-4" aria-labelledby="approve-changes-h">
          <h3 id="approve-changes-h" className="text-sm font-semibold text-slate-900">What changed since approved version {N - 1}</h3>
          {lines.length
            ? <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-700" data-testid="approve-changes">{lines.map((l, i) => <li key={i} className="rounded-lg bg-slate-50 px-3 py-1.5">{l}</li>)}</ul>
            : <p className="mt-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm text-slate-700" data-testid="approve-changes">No section reads differently. Saved changes were undone or change nothing in the documents.</p>}
        </section>
        <label className="mt-5 block text-sm font-semibold text-slate-900" htmlFor="approve-reason">{REASON_LABEL}</label>
        <p className="text-xs text-slate-500" id="approve-reason-help">{reasonHelp(N)}</p>
        <textarea id="approve-reason" name="reason" rows={3} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} aria-describedby="approve-reason-help" aria-invalid={(tried || Boolean(reason.trim())) && Boolean(problem) || undefined}
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm leading-6 focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20" data-testid="approve-reason" />
        {(tried || reason.trim()) && problem && <p role="alert" className="mt-1 text-sm font-medium text-red-700" data-testid="approve-problem">{problem}</p>}
        {error && <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950 ring-1 ring-inset ring-amber-200" data-testid="approve-error">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => ref.current?.close()}>Cancel</Button>
          <Button type="submit" disabled={busy || Boolean(problem)} data-testid="approve-confirm">{busy ? 'Approving…' : `Approve version ${N}`}</Button>
        </div>
      </form>
    </dialog>
  );
}
