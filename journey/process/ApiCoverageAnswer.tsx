// The answer to "Does X have an API that covers <step>?" (package 13 B). For one step, Yes or No. For a
// question that serves several steps, the steps are listed and the person ticks the ones the API does;
// the others are recorded as not done by it. Either way the question is not asked again
// (answerApiCoverage in domain/processModel/patch.ts).
import React from 'react';
import { Button } from '../ui.tsx';
import { absentOperations } from '../../domain/assess/coverage.ts';
import type { SystemRef } from '../../domain/processModel/types.ts';

/** What the sources say the application's API cannot do, beside the question about it (owner, 19 November 2026). */
export function AbsentOperations({ system }: { system: SystemRef }) {
  const ops = absentOperations(system);
  if (!ops.length) return null;
  return <p className="mt-1 text-xs leading-5 text-slate-500" data-testid="api-absent">The sources say {system.name} has no API to: {ops.join('; ')}.</p>;
}

export function ApiCoverageAnswer({ system, steps, onSave, onCancel }: {
  system: string; steps: { id: string; name: string }[];
  onSave: (covers: string[], notCovers: string[]) => void; onCancel?: () => void;
}) {
  const [ticked, setTicked] = React.useState<Set<string>>(new Set());
  const ids = steps.map(s => s.id);
  if (steps.length === 1) return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="api-answer">
      <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => onSave(ids, [])}>Yes, its API does this</Button>
      <Button variant="ghost" className="px-3 py-1 text-xs" onClick={() => onSave([], ids)}>No</Button>
      {onCancel && <Button variant="ghost" className="px-3 py-1 text-xs" onClick={onCancel}>Cancel</Button>}
    </div>
  );
  const toggle = (id: string) => setTicked(cur => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return (
    <fieldset className="mt-2 rounded-xl bg-white p-3 ring-1 ring-slate-200" data-testid="api-answer">
      <legend className="px-1 text-xs font-semibold text-slate-600">Tick the steps the API of {system} does</legend>
      <ul className="space-y-1">
        {steps.map(s => (
          <li key={s.id}>
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input type="checkbox" checked={ticked.has(s.id)} onChange={() => toggle(s.id)} aria-label={`The API of ${system} does "${s.name}"`} />
              {s.name}
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">The steps left unticked are recorded as not done by it. Neither is asked again.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button className="px-3 py-1 text-xs" onClick={() => onSave([...ticked], ids.filter(id => !ticked.has(id)))}>Save answer</Button>
        {onCancel && <Button variant="ghost" className="px-3 py-1 text-xs" onClick={onCancel}>Cancel</Button>}
      </div>
    </fieldset>
  );
}
