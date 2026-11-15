// A typical process to start from (docs/effort-first-plan.md, part I), on the Sources stage of a process
// with no sources: the reference the process name suggests (or the one on offer), its applications
// mapped to the person's own, and "Start from the typical process". Everything comes in marked Typical;
// the Process stage then asks, item by item: we do this, ours is different, we don't. Rules:
// domain/reference/typical.ts.
import React from 'react';
import type { JourneyStore } from '../store/types.ts';
import { startFromTypical } from '../../domain/processModel/patch.ts';
import { matchReference, REFERENCES, typicalElements, type ReferenceProcess } from '../../domain/reference/typical.ts';
import { Button, ErrorNote, messageOf } from '../ui.tsx';

const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';

export function StartFromTypical({ store, processId, processName, onStarted }: { store: JourneyStore; processId: string; processName: string; onStarted: () => void }) {
  const suggested = matchReference(processName);
  const [open, setOpen] = React.useState(false);
  const [ref, setRef] = React.useState<ReferenceProcess>(suggested ?? REFERENCES[0]);
  const [apps, setApps] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const what = ref.name.charAt(0).toLowerCase() + ref.name.slice(1);
  // Offered only when the process name suggests one (part I: "offers the reference when the process name matches").
  if (!suggested) return null;

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const draft = await store.startDraft(processId);
      const r = startFromTypical(draft.model, { elements: typicalElements(ref, apps), from: ref.id });
      await store.savePatch(draft.revisionId, draft.seq, r.patch, 'user', `Started from a typical ${what} (every item marked Typical until confirmed)`);
      onStarted();
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="Start from a typical process" data-testid="typical-start">
      <h3 className="text-sm font-semibold text-slate-900">Or start from a typical process</h3>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
        This looks like <strong>{what}</strong>. 
        Start from a typical {what} and confirm it step by step: we do this, ours is different, or we don't.
        Everything stays marked <strong>Typical</strong> until your people confirm it, and documents say so. It brings no volumes, times, costs or application facts.
      </p>
      {!open ? (
        <Button variant="secondary" className="mt-3" onClick={() => setOpen(true)}>Start from a typical process</Button>
      ) : (
        <div className="mt-4 space-y-4">
          {REFERENCES.length > 1 && (
            <label className="block text-sm font-medium text-slate-700">Which typical process
              <select className={`${input} mt-1`} value={ref.id} onChange={e => setRef(REFERENCES.find(r => r.id === e.target.value)!)}>
                {REFERENCES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          )}
          <fieldset>
            <legend className="text-sm font-medium text-slate-700">Your applications <span className="font-normal text-slate-500">(optional; leave empty to confirm later)</span></legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {ref.systems.map(s => (
                <label key={s.id} className="block text-sm text-slate-700">{s.name}
                  <input className={`${input} mt-1`} value={apps[s.id] ?? ''} onChange={e => setApps(a => ({ ...a, [s.id]: e.target.value }))} placeholder="Its name" />
                </label>
              ))}
            </div>
          </fieldset>
          <ErrorNote message={error} />
          <div className="flex flex-wrap gap-2">
            <Button variant="accent" disabled={busy} onClick={start}>{busy ? 'Starting…' : `Start from the typical ${what}`}</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}
