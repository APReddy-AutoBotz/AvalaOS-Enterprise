// A typical process to start from (docs/effort-first-plan.md, part I), on the Sources stage of a process
// with no sources. Avala OS never says which typical process fits (owner, 16 November 2026): the person
// picks one from the list, sees its steps, rules and exceptions, maps its applications to their own and
// only then starts from it. Everything comes in marked Typical; the Process stage then asks, item by
// item: we do this, ours is different, we don't. Rules: domain/reference/typical.ts.
import React from 'react';
import type { JourneyStore } from '../store/types.ts';
import { startFromTypical } from '../../domain/processModel/patch.ts';
import { REFERENCES, referenceById, typicalElements } from '../../domain/reference/typical.ts';
import { Button, ErrorNote, messageOf } from '../ui.tsx';

const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';

export function StartFromTypical({ store, processId, onStarted }: { store: JourneyStore; processId: string; onStarted: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [refId, setRefId] = React.useState('');
  const [apps, setApps] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ref = referenceById(refId);

  const start = async () => {
    if (!ref) return;
    setBusy(true); setError(null);
    try {
      const draft = await store.startDraft(processId);
      const r = startFromTypical(draft.model, { elements: typicalElements(ref, apps), from: ref.id });
      await store.savePatch(draft.revisionId, draft.seq, r.patch, 'user', `Started from a typical ${ref.noun} (every item marked Typical until confirmed)`);
      onStarted();
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="Start from a typical process" data-testid="typical-start">
      <h3 className="text-sm font-semibold text-slate-900">Or start from a typical process</h3>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
        Some processes run in much the same way in most companies. If yours is one of those below, you can start from the typical one and confirm it step by step: we do this, ours is different, or we don't.
        Everything stays marked <strong>Typical</strong> until your people confirm it, and documents say so. It brings no volumes, times, costs or application facts.
      </p>
      {!open ? (
        <Button variant="secondary" className="mt-3" onClick={() => setOpen(true)}>See the typical processes</Button>
      ) : (
        <div className="mt-4 space-y-4">
          <label className="block max-w-md text-sm font-medium text-slate-700">Which typical process
            <select className={`${input} mt-1`} value={refId} onChange={e => { setRefId(e.target.value); setApps({}); }} data-testid="typical-choice">
              <option value="">Choose one…</option>
              {REFERENCES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          {!ref && <p className="text-sm text-slate-600">Not in the list? Add your documents above, or tell us in your own words. Nothing is assumed about your process.</p>}
          {ref && (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4" data-testid="typical-preview">
                <p className="text-sm font-medium text-slate-900">What you would start from</p>
                <p className="mt-1 text-sm text-slate-600">{ref.steps.length} steps, {ref.rules.length} rules and {ref.exceptions.length} exceptions. Read them first: if this is not your kind of process, do not start from it.</p>
                <details className="mt-3" open>
                  <summary className="cursor-pointer text-sm font-medium text-[#002C4B]">The {ref.steps.length} steps</summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-700">
                    {ref.steps.map(st => <li key={st.id}><span className="font-medium text-slate-900">{st.name}.</span> {st.description}</li>)}
                  </ol>
                </details>
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-[#002C4B]">The {ref.rules.length} rules</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                    {ref.rules.map(r => <li key={r.id}><span className="font-medium text-slate-900">{r.name}.</span> {r.condition}: {r.action.charAt(0).toLowerCase() + r.action.slice(1)}.</li>)}
                  </ul>
                </details>
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-[#002C4B]">The {ref.exceptions.length} exceptions</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                    {ref.exceptions.map(x => <li key={x.id}><span className="font-medium text-slate-900">{x.name}.</span> {x.handling}.</li>)}
                  </ul>
                </details>
              </div>
              <fieldset>
                <legend className="text-sm font-medium text-slate-700">Your applications <span className="font-normal text-slate-500">(optional; leave empty to name later, or to say you don't use one)</span></legend>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {ref.systems.map(s => (
                    <label key={s.id} className="block text-sm text-slate-700">{s.name}
                      <input className={`${input} mt-1`} value={apps[s.id] ?? ''} onChange={e => setApps(a => ({ ...a, [s.id]: e.target.value }))} placeholder="Its name" />
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          <ErrorNote message={error} />
          <div className="flex flex-wrap gap-2">
            {ref && <Button variant="accent" disabled={busy} onClick={start}>{busy ? 'Starting…' : `Start from the typical ${ref.noun}`}</Button>}
            <Button variant="ghost" onClick={() => { setOpen(false); setRefId(''); }}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}
