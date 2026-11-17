// Settings → "Walkthrough requests": what visitors sent from the homepage's form (package 11). The platform
// owner alone sees this section, and the database refuses anyone else. Everything a visitor typed is shown as
// plain text. "Reply by email" opens the owner's email program addressed to the visitor; using it, or setting
// a status, counts as contact, and twelve months after the last contact the request is deleted on its own.
import React from 'react';
import type { JourneyStore } from '../store/types.ts';
import { PEOPLE_LABEL, replyLink, STATUS_LABEL, type InquiryStatus, type WalkthroughRequest } from '../../domain/site/inquiry.ts';
import { CARD, cx, ErrorNote, messageOf, Spinner, when } from '../ui.tsx';

export function WalkthroughRequests({ store }: { store: JourneyStore }) {
  const [rows, setRows] = React.useState<WalkthroughRequest[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const load = React.useCallback(() => {
    store.listWalkthroughRequests().then(r => { setRows(r); setError(null); }).catch(e => { setRows([]); setError(messageOf(e)); });
  }, [store]);
  React.useEffect(() => { load(); }, [load]);

  const act = async (f: () => Promise<void>) => { setError(null); try { await f(); load(); } catch (e) { setError(messageOf(e)); } };
  const contacted = (id: string) => setRows(cur => (cur ?? []).map(r => (r.id === id ? { ...r, lastContactAt: new Date().toISOString() } : r)));

  return (
    <section className={cx(CARD, 'p-6')} data-testid="walkthrough-requests" aria-labelledby="requests-h">
      <h2 id="requests-h" className="font-display text-lg font-semibold text-slate-900">Walkthrough requests</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">Sent from the homepage, newest first. Only you see them. Replying by email, or setting a status, counts as contact; a request is deleted twelve months after the last contact.</p>
      <ErrorNote message={error} />
      {rows === null ? <div className="mt-4"><Spinner /></div> : rows.length === 0 ? (
        !error && <p className="mt-4 text-sm text-slate-500">No requests yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {rows.map(r => {
            const mail = replyLink(r.email);
            return (
              <li key={r.id} className="py-4" data-testid="walkthrough-request">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900"><span data-testid="request-name">{r.name}</span><span className="font-normal text-slate-600">, {r.company}</span></p>
                    <p className="mt-0.5 break-all text-sm text-slate-700">{r.email}</p>
                    <p className="mt-0.5 text-xs text-slate-500">Sent {when(r.createdAt)}{r.people ? ` · ${PEOPLE_LABEL[r.people]} people` : ''} · last contact {when(r.lastContactAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-sm text-slate-600">
                      <span className="sr-only">Status of the request from {r.name}</span>
                      <select value={r.status} onChange={e => act(() => store.setWalkthroughRequestStatus(r.id, e.target.value as InquiryStatus))}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900">
                        {(Object.keys(STATUS_LABEL) as InquiryStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    </label>
                    {mail && (
                      <a href={mail} onClick={() => { contacted(r.id); store.noteWalkthroughReply(r.id).catch(e => setError(messageOf(e))); }}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-[#002C4B] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002C4B]">Reply by email</a>
                    )}
                    {confirming === r.id ? (
                      <span className="flex items-center gap-2 text-sm">
                        <span className="text-slate-700">Delete for good?</span>
                        <button type="button" className="font-semibold text-red-700 hover:underline" onClick={() => { setConfirming(null); act(() => store.deleteWalkthroughRequest(r.id)); }}>Delete</button>
                        <button type="button" className="text-slate-600 hover:underline" onClick={() => setConfirming(null)}>Keep</button>
                      </span>
                    ) : <button type="button" className="text-sm text-slate-600 hover:underline" aria-label={`Delete the request from ${r.name}`} onClick={() => setConfirming(r.id)}>Delete</button>}
                  </div>
                </div>
                {/* Plain text only: React escapes it, and the line breaks a visitor typed are kept as text. */}
                {r.process && <p className="mt-2 whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700" data-testid="request-process">{r.process}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
