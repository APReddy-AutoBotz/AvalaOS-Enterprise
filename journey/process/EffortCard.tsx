// "Effort so far" (docs/effort-first-plan.md, part H): what it took to get this process to documents,
// counted from what is already recorded (sources, history, questions, the delivery plan). Nothing is
// estimated: a time that was not recorded says so. Rules: domain/work/effort.ts.
import React from 'react';
import type { JourneyStore, SourceRow } from '../store/types.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { effortLines, effortOf, type Effort } from '../../domain/work/effort.ts';

export function EffortCard({ store, processId, model, sources, plan, documents }: {
  store: JourneyStore; processId: string; model: ProcessModel; sources: SourceRow[];
  plan: { now: number; found: number; wait: number }; documents: string[];
}) {
  const [history, setHistory] = React.useState<Awaited<ReturnType<JourneyStore['history']>> | null>(null);
  React.useEffect(() => { store.history(processId).then(setHistory).catch(() => setHistory({ revisions: [], edits: [] })); }, [store, processId, model]);
  if (!history) return null;
  const firstRevisionAt = [...history.revisions].map(r => r.createdAt).sort()[0] ?? null;
  const effort: Effort = effortOf({ sources: sources.map(s => ({ key: s.key, createdAt: s.createdAt })), edits: history.edits, firstRevisionAt, model, plan, documents });
  const lines = effortLines(effort);
  const big = lines.filter(l => ['draft', 'people', 'sources', 'open'].includes(l.key));
  const rest = lines.filter(l => !['draft', 'people', 'sources', 'open'].includes(l.key));
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="Effort so far" data-testid="effort-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-semibold text-slate-900">Effort so far</h3>
        <p className="text-xs text-slate-600">Counted from what is recorded: the sources, the history and the questions. Nothing is estimated.</p>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-slate-200 ring-1 ring-slate-200 sm:grid-cols-4">
        {big.map(l => (
          <div key={l.key} className="bg-white px-4 py-3" data-testid={`effort-${l.key}`}>
            <dt className="text-xs text-slate-600">{l.label}</dt>
            <dd className="mt-1 font-display text-lg font-semibold text-[#002C4B]">{l.value}</dd>
          </div>
        ))}
      </dl>
      <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {rest.map(l => (
          <div key={l.key} className="flex justify-between gap-3 border-b border-slate-100 py-1" data-testid={`effort-${l.key}`}>
            <dt className="text-slate-600">{l.label}</dt>
            <dd className="text-right font-medium text-slate-900">{l.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
