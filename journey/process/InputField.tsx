// An input of the assessment answered with its own field (moved out of DiscoveryPanel.tsx unchanged, 28 November 2026,
// so the call's review uses the same field and words).
import React from 'react';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { InputField, InputValue } from '../../domain/discovery/inputs.ts';

/**
 * The field an input card asks with: the Inputs view's own answers. Shared by Discovery and the review at the end of a
 * call (package C, preview walk, 28 November 2026). `name` groups the radio buttons of one card.
 */
export function FieldInput({ name, field, model, value, onChange }: { name: string; field: InputField; model: ProcessModel; value: InputValue; onChange: (v: InputValue) => void }) {
  const f = field;
  const input = 'rounded-lg border border-slate-300 px-2 py-1 text-sm';
  const stepName = (id: string) => model.steps.find(s => s.id === id)?.name ?? id;
  if (f.kind === 'figure') return (
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label="Number" inputMode="decimal" className={input} value={value.number ?? ''} onChange={e => onChange({ ...value, number: e.target.value === '' ? undefined : Number(e.target.value) })} />
      {f.period && <select aria-label="Period" className={input} value={value.period ?? ''} onChange={e => onChange({ ...value, period: (e.target.value || undefined) as InputValue['period'] })}>
        <option value="">a…</option>{(['day', 'week', 'month', 'quarter', 'year'] as const).map(p => <option key={p} value={p}>a {p}</option>)}
      </select>}
      {f.units && <select aria-label="Unit" className={input} value={value.unit ?? ''} onChange={e => onChange({ ...value, unit: (e.target.value || undefined) as InputValue['unit'] })}>
        <option value="">unit</option>{f.units.map(u => <option key={u} value={u}>{u}</option>)}
      </select>}
    </div>
  );
  if (f.kind === 'change') return (
    <fieldset className="space-y-1">{(['none', 'minor', 'major'] as const).map(l => (
      <label key={l} className="flex items-center gap-2 text-sm"><input type="radio" name={name} checked={value.level === l} onChange={() => onChange({ ...value, level: l })} />{l === 'none' ? 'No change' : l === 'minor' ? 'Minor changes' : 'Major changes'}</label>
    ))}</fieldset>
  );
  if (f.kind === 'api') return (
    <ul className="space-y-1">{f.stepIds.map(id => (
      <li key={id} className="flex items-center gap-2 text-sm">
        <span className="flex-1">{stepName(id)}</span>
        <select aria-label={`API for ${stepName(id)}`} className={input} value={value.covers?.includes(id) ? 'yes' : value.notCovers?.includes(id) ? 'no' : ''}
          onChange={e => onChange({ ...value, covers: [...(value.covers ?? []).filter(x => x !== id), ...(e.target.value === 'yes' ? [id] : [])], notCovers: [...(value.notCovers ?? []).filter(x => x !== id), ...(e.target.value === 'no' ? [id] : [])] })}>
          <option value="">Not known</option><option value="yes">Covers it</option><option value="no">Does not cover it</option>
        </select>
      </li>
    ))}</ul>
  );
  if (f.kind === 'fact') return (
    <div className="space-y-2">
      <fieldset className="space-y-1">{f.choices.map(([v, l]) => (
        <label key={v} className="flex items-center gap-2 text-sm"><input type="radio" name={name} checked={value.pick === v} onChange={() => onChange({ ...value, pick: v })} />{l}</label>
      ))}</fieldset>
      {f.sameForAll && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(value.sameForAll)} onChange={e => onChange({ ...value, sameForAll: e.target.checked })} />The same for every step</label>}
    </div>
  );
  return (
    <ul className="space-y-1">{f.stepIds.map(id => (
      <li key={id} className="flex items-center gap-2 text-sm">
        <span className="flex-1">{stepName(id)}</span>
        <input aria-label={`${f.trait === 'effortMinutes' ? 'Minutes' : 'Share'} for ${stepName(id)}`} inputMode="decimal" className={`${input} w-24`} value={value.perStep?.[id] ?? ''}
          onChange={e => onChange({ ...value, perStep: { ...(value.perStep ?? {}), [id]: Number(e.target.value) } })} />
        <span className="text-xs text-slate-500">{f.trait === 'effortMinutes' ? 'minutes' : '%'}</span>
      </li>
    ))}</ul>
  );
}
