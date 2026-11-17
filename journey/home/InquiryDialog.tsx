// The walkthrough request window (docs/next-plan.md, section 3d, package 11), opened from "Book a walkthrough".
// A native modal dialog: the page behind it cannot be reached by keyboard or pointer while it is open, Escape
// closes it, and focus goes back to the button that opened it. It exists only while open, so the page itself
// does not grow. The same rule as the server checks the fields first (domain/site/inquiry.ts); the wait before
// sending is elapsed time measured here, in the browser. Whatever goes wrong, the visitor gets the address.
import React from 'react';
import { checkInquiry, FIELD_LABEL, INQUIRY_LIMITS, PEOPLE_CHOICES, PROMISE, REFUSED, THANKS, TRAP_FIELD, type Inquiry } from '../../domain/site/inquiry.ts';
import { CONTACT_EMAIL } from '../../domain/site/trust.ts';
import { focus } from './site.tsx';

/** The server function's address: the project's own, or the same site when none is configured (tests stub it there). */
export const INQUIRY_URL = `${(import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''}/functions/v1/journey-inquiry`;

type State = { kind: 'editing' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'failed' };

export function InquiryDialog({ onClose }: { onClose: () => void }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const opened = React.useRef(performance.now());
  const [state, setState] = React.useState<State>({ kind: 'editing' });
  const [fields, setFields] = React.useState({ name: '', email: '', company: '', process: '', people: '', [TRAP_FIELD]: '' });
  const [problem, setProblem] = React.useState<{ field?: keyof Inquiry; message: string } | null>(null);

  React.useEffect(() => {
    const d = ref.current;
    if (d && !d.open) { d.showModal(); opened.current = performance.now(); }
  }, []);

  // Tab and Shift+Tab go round the window's own controls, never out to the browser's.
  const keepFocus = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const all = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([tabindex="-1"]), select, textarea')].filter(el => el.offsetParent !== null);
    if (!all.length) return;
    const first = all[0]!, last = all[all.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => { setFields(f => ({ ...f, [k]: e.target.value })); setProblem(null); };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.kind === 'sending') return;
    // What the visitor can fix is said beside the form before anything is sent.
    const local = checkInquiry(fields, { requireTiming: false });
    if (!local.ok && local.reason !== 'trap') { setProblem({ field: local.field, message: local.message }); return; }
    setState({ kind: 'sending' });
    try {
      const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;
      const res = await fetch(INQUIRY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { apikey: key } : {}) },
        body: JSON.stringify({ ...fields, elapsedMs: Math.round(performance.now() - opened.current) }),
      });
      setState(res.ok ? { kind: 'sent' } : { kind: 'failed' });
    } catch { setState({ kind: 'failed' }); }
  };

  const input = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#002C4B]';
  const field = (k: 'name' | 'email' | 'company', type: string, auto: string) => (
    <label className="block text-sm font-medium text-slate-800">
      {FIELD_LABEL[k]}
      <input name={k} type={type} autoComplete={auto} required maxLength={INQUIRY_LIMITS[k]} value={fields[k]} onChange={set(k)}
        aria-invalid={problem?.field === k || undefined} aria-describedby={problem?.field === k ? 'inquiry-problem' : undefined} className={input} />
    </label>
  );

  return (
    <dialog ref={ref} onClose={onClose} onKeyDown={keepFocus} aria-labelledby="inquiry-h" data-testid="inquiry"
      className="w-[min(36rem,calc(100vw-2rem))] rounded-2xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-[#001B2F]/70">
      <div className="max-h-[calc(100vh-2rem)] overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id="inquiry-h" className="font-display text-2xl font-semibold tracking-tight">Book a walkthrough</h2>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className={`rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 ${focus} focus-visible:outline-[#002C4B]`}>✕</button>
        </div>
        {state.kind === 'sent' ? (
          <div className="mt-4">
            <p role="status" className="text-base leading-7 text-slate-700" data-testid="inquiry-thanks">{THANKS}</p>
            <button type="button" onClick={() => ref.current?.close()} className={`mt-5 rounded-lg bg-[#002C4B] px-4 py-2 text-sm font-semibold text-white ${focus} focus-visible:outline-[#002C4B]`}>Close</button>
          </div>
        ) : (
          <form onSubmit={send} noValidate className="mt-4 space-y-4">
            <p className="text-sm leading-6 text-slate-600">We take one process through Avala OS with you. Tell us who you are and we will arrange a time.</p>
            {field('name', 'text', 'name')}
            {field('email', 'email', 'email')}
            {field('company', 'text', 'organization')}
            <label className="block text-sm font-medium text-slate-800">
              {FIELD_LABEL.process} <span className="font-normal text-slate-500">(optional)</span>
              <textarea name="process" rows={3} maxLength={INQUIRY_LIMITS.process} value={fields.process} onChange={set('process')} className={input} />
            </label>
            <label className="block text-sm font-medium text-slate-800">
              {FIELD_LABEL.people} <span className="font-normal text-slate-500">(optional)</span>
              <select name="people" value={fields.people} onChange={set('people')} className={input}>
                <option value="">Not given</option>
                {PEOPLE_CHOICES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
            {/* People never see or fill this; a form-filling program usually does. */}
            <div aria-hidden="true" className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
              <label>Website<input name={TRAP_FIELD} type="text" tabIndex={-1} autoComplete="off" value={fields[TRAP_FIELD]} onChange={set(TRAP_FIELD)} /></label>
            </div>
            {problem && <p id="inquiry-problem" role="alert" className="text-sm font-medium text-red-700">{problem.message}</p>}
            {state.kind === 'failed' && (
              <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950 ring-1 ring-inset ring-amber-200" data-testid="inquiry-failed">
                {REFUSED.replace(`${CONTACT_EMAIL}.`, '')}<a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold underline">{CONTACT_EMAIL}</a>.
              </p>
            )}
            <p className="text-xs leading-5 text-slate-500">{PROMISE} (see our <a href="/privacy#collect" className="font-medium text-slate-700 underline underline-offset-2">privacy notice</a>).</p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={state.kind === 'sending'} className={`rounded-lg bg-[#E69F00] px-5 py-2.5 text-sm font-semibold text-[#001B2F] hover:bg-[#F2B21E] disabled:cursor-not-allowed disabled:opacity-60 ${focus} focus-visible:outline-[#002C4B]`}>
                {state.kind === 'sending' ? 'Sending…' : 'Send'}
              </button>
              <button type="button" onClick={() => ref.current?.close()} className={`rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 ${focus} focus-visible:outline-[#002C4B]`}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
