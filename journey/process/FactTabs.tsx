// Rules and decisions, exceptions, data and figures.
import React from 'react';
import { addRule, removeElement, updateFact } from '../../domain/processModel/patch.ts';
import { outgoing } from '../../domain/processModel/selectors.ts';
import type { ElementTarget } from '../../domain/processModel/types.ts';
import { Button } from '../ui.tsx';
import type { TabContext } from './ProcessEditor.tsx';
import { ConfirmDelete, InlineText, Select, SourcesButton, StatusBadge, TableShell } from './widgets.tsx';

const setter = ({ editor }: TabContext, kind: ElementTarget['kind']) =>
  (id: string, field: string, value: unknown, summary: string) => editor.apply(m => updateFact(m, { target: { kind, id, field }, value }), summary);

export function RulesTab(ctx: TabContext) {
  const { model, editor, canEdit, showSources } = ctx;
  const setRule = setter(ctx, 'rule');
  const setGateway = setter(ctx, 'gateway');
  const nodeName = (id: string) => model.steps.find(s => s.id === id)?.name ?? model.events.find(e => e.id === id)?.name ?? model.gateways.find(g => g.id === id)?.question ?? id;
  const [draft, setDraft] = React.useState({ name: '', condition: '', action: '' });
  const ready = draft.name.trim() && draft.condition.trim() && draft.action.trim();

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="font-display text-sm font-semibold text-slate-900">Business rules</h3>
        <TableShell head={['Rule', 'When', 'Then', 'Status', '']} empty={model.rules.length === 0 ? <p className="p-4 text-center text-sm text-slate-500">No rules yet.</p> : undefined}>
          {model.rules.map(r => (
            <tr key={r.id} className="align-top" data-testid="rule-row">
              <td className="min-w-40 px-1 py-1"><InlineText value={r.name} label={`Name of rule ${r.name}`} disabled={!canEdit} onSave={v => setRule(r.id, 'name', v, `Renamed rule ${r.name}`)} /></td>
              <td className="min-w-56 px-1 py-1"><InlineText multiline value={r.condition} label={`Condition of ${r.name}`} disabled={!canEdit} onSave={v => setRule(r.id, 'condition', v, `Changed condition of ${r.name}`)} /></td>
              <td className="min-w-56 px-1 py-1"><InlineText multiline value={r.action} label={`Action of ${r.name}`} disabled={!canEdit} onSave={v => setRule(r.id, 'action', v, `Changed action of ${r.name}`)} /></td>
              <td className="px-3 py-2"><StatusBadge status={r.status} /><div><SourcesButton count={r.sources.length} what={r.name} onClick={() => showSources(r.name, r.sources)} /></div></td>
              <td className="px-3 py-2 text-right"><ConfirmDelete what={`rule ${r.name}`} disabled={!canEdit} onDelete={() => editor.apply(m => removeElement(m, { kind: 'rule', id: r.id }), `Deleted rule ${r.name}`)} /></td>
            </tr>
          ))}
        </TableShell>
        {canEdit && (
          <form className="grid gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
            onSubmit={async e => { e.preventDefault(); if (ready && await editor.apply(m => addRule(m, draft), `Added rule ${draft.name.trim()}`)) setDraft({ name: '', condition: '', action: '' }); }}>
            {(['name', 'condition', 'action'] as const).map(f => (
              <label key={f} className="text-xs font-medium text-slate-600">{f === 'name' ? 'New rule' : f === 'condition' ? 'When' : 'Then'}
                <input value={draft[f]} onChange={e => setDraft({ ...draft, [f]: e.target.value })} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              </label>
            ))}
            <div className="flex items-end"><Button type="submit" variant="secondary" disabled={!ready}>Add rule</Button></div>
          </form>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-display text-sm font-semibold text-slate-900">Decisions</h3>
        <TableShell head={['Question', 'Kind', 'Outcomes', 'Status']} empty={model.gateways.length === 0 ? <p className="p-4 text-center text-sm text-slate-500">No decisions yet.</p> : undefined}>
          {model.gateways.map(g => (
            <tr key={g.id} className="align-top">
              <td className="min-w-56 px-1 py-1"><InlineText value={g.question} label={`Decision ${g.question}`} disabled={!canEdit} onSave={v => setGateway(g.id, 'question', v, `Reworded decision ${g.question}`)} /></td>
              <td className="px-3 py-2"><Select value={g.type} options={[{ value: 'exclusive', label: 'One path' }, { value: 'parallel', label: 'All paths' }]} label={`Kind of ${g.question}`} disabled={!canEdit} onChange={v => setGateway(g.id, 'type', v, `Changed decision ${g.question}`)} /></td>
              <td className="px-3 py-2">
                <ul className="space-y-0.5 text-xs text-slate-700">
                  {outgoing(model, g.id).map(f => <li key={f.id}><span className="font-semibold">{f.label || 'Next'}</span> → {nodeName(f.to)}</li>)}
                </ul>
              </td>
              <td className="px-3 py-2"><StatusBadge status={g.status} /><div><SourcesButton count={g.sources.length} what={g.question} onClick={() => showSources(g.question, g.sources)} /></div></td>
            </tr>
          ))}
        </TableShell>
      </section>
    </div>
  );
}

export function ExceptionsTab(ctx: TabContext) {
  const { model, editor, canEdit, showSources } = ctx;
  const set = setter(ctx, 'exception');
  const roles = [{ value: '', label: 'Not stated' }, ...model.roles.map(r => ({ value: r.id, label: r.name }))];
  return (
    <TableShell head={['Exception', 'Kind', 'Trigger', 'Handling', 'Routed to', 'Status', '']}
      empty={model.exceptions.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No exceptions yet.</p> : undefined}>
      {model.exceptions.map(x => (
        <tr key={x.id} className="align-top">
          <td className="min-w-40 px-1 py-1"><InlineText value={x.name} label={`Name of exception ${x.name}`} disabled={!canEdit} onSave={v => set(x.id, 'name', v, `Renamed exception ${x.name}`)} /></td>
          <td className="px-3 py-2"><Select value={x.kind} options={[{ value: 'business', label: 'Business' }, { value: 'application', label: 'Application' }]} label={`Kind of ${x.name}`} disabled={!canEdit} onChange={v => set(x.id, 'kind', v, `Changed exception ${x.name}`)} /></td>
          <td className="min-w-48 px-1 py-1"><InlineText multiline value={x.trigger} label={`Trigger of ${x.name}`} disabled={!canEdit} onSave={v => set(x.id, 'trigger', v, `Changed trigger of ${x.name}`)} /></td>
          <td className="min-w-48 px-1 py-1"><InlineText multiline value={x.handling} label={`Handling of ${x.name}`} disabled={!canEdit} onSave={v => set(x.id, 'handling', v, `Changed handling of ${x.name}`)} /></td>
          <td className="px-3 py-2"><Select value={x.routedToRoleId ?? ''} options={roles} label={`${x.name} is routed to`} disabled={!canEdit} onChange={v => set(x.id, 'routedToRoleId', v || undefined, `Changed routing of ${x.name}`)} /></td>
          <td className="px-3 py-2"><StatusBadge status={x.status} /><div><SourcesButton count={x.sources.length} what={x.name} onClick={() => showSources(x.name, x.sources)} /></div></td>
          <td className="px-3 py-2 text-right"><ConfirmDelete what={`exception ${x.name}`} disabled={!canEdit} onDelete={() => editor.apply(m => removeElement(m, { kind: 'exception', id: x.id }), `Deleted exception ${x.name}`)} /></td>
        </tr>
      ))}
    </TableShell>
  );
}

export function DataTab(ctx: TabContext) {
  const { model, editor, canEdit, showSources } = ctx;
  const setData = setter(ctx, 'data');
  const setMetric = setter(ctx, 'metric');
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="font-display text-sm font-semibold text-slate-900">Figures</h3>
        <p className="text-xs text-slate-500">Only figures the sources state. An empty value is unknown, not zero.</p>
        <TableShell head={['Figure', 'Value', 'Unit', 'Status']} empty={model.meta.metrics.length === 0 ? <p className="p-4 text-center text-sm text-slate-500">No figures yet.</p> : undefined}>
          {model.meta.metrics.map(x => (
            <tr key={x.id} className="align-top">
              <td className="min-w-48 px-1 py-1"><InlineText value={x.label} label={`Figure ${x.label}`} disabled={!canEdit} onSave={v => setMetric(x.id, 'label', v, `Renamed figure ${x.label}`)} /></td>
              <td className="w-40 px-1 py-1">
                <NumberCell value={x.value} range={x.range} label={`Value of ${x.label}`} disabled={!canEdit} onSave={v => setMetric(x.id, 'value', v, `Changed ${x.label}`)} />
              </td>
              <td className="px-1 py-1"><InlineText value={x.unit} label={`Unit of ${x.label}`} disabled={!canEdit} onSave={v => setMetric(x.id, 'unit', v, `Changed unit of ${x.label}`)} /></td>
              <td className="px-3 py-2"><StatusBadge status={x.status} /><div><SourcesButton count={x.sources.length} what={x.label} onClick={() => showSources(x.label, x.sources)} /></div></td>
            </tr>
          ))}
        </TableShell>
      </section>
      <section className="space-y-2">
        <h3 className="font-display text-sm font-semibold text-slate-900">Data</h3>
        <TableShell head={['Data', 'Format', 'Structured', 'Classification', 'Status', '']} empty={model.dataObjects.length === 0 ? <p className="p-4 text-center text-sm text-slate-500">No data objects yet.</p> : undefined}>
          {model.dataObjects.map(d => (
            <tr key={d.id} className="align-top">
              <td className="px-1 py-1"><InlineText value={d.name} label={`Data ${d.name}`} disabled={!canEdit} onSave={v => setData(d.id, 'name', v, `Renamed data ${d.name}`)} /></td>
              <td className="px-1 py-1"><InlineText value={d.format} label={`Format of ${d.name}`} disabled={!canEdit} onSave={v => setData(d.id, 'format', v, `Changed format of ${d.name}`)} /></td>
              <td className="px-3 py-2"><Select value={d.structured === null ? '' : d.structured ? 'yes' : 'no'} options={[{ value: '', label: 'Unknown' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} label={`${d.name} is structured`} disabled={!canEdit} onChange={v => setData(d.id, 'structured', (v as string) === '' ? null : v === 'yes', `Changed ${d.name}`)} /></td>
              <td className="px-1 py-1"><InlineText value={d.classification ?? ''} placeholder="Not stated" label={`Classification of ${d.name}`} disabled={!canEdit} onSave={v => setData(d.id, 'classification', v, `Classified ${d.name}`)} /></td>
              <td className="px-3 py-2"><StatusBadge status={d.status} /><div><SourcesButton count={d.sources.length} what={d.name} onClick={() => showSources(d.name, d.sources)} /></div></td>
              <td className="px-3 py-2 text-right"><ConfirmDelete what={`data ${d.name}`} disabled={!canEdit} onDelete={() => editor.apply(m => removeElement(m, { kind: 'data', id: d.id }), `Deleted data ${d.name}`)} /></td>
            </tr>
          ))}
        </TableShell>
      </section>
    </div>
  );
}

/** A number, or empty for unknown. A stated range is shown when there is no single value. */
function NumberCell({ value, range, label, disabled, onSave }: { value: number | null; range?: [number, number]; label: string; disabled?: boolean; onSave: (v: number | null) => void }) {
  const shown = value === null ? '' : String(value);
  const [draft, setDraft] = React.useState(shown);
  React.useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const t = draft.replace(/,/g, '').trim();
    if (t === shown) return;
    if (t === '') { onSave(null); return; }
    const n = Number(t);
    if (Number.isFinite(n)) onSave(n); else setDraft(shown);
  };
  return (
    <div>
      <input aria-label={label} inputMode="decimal" value={draft} disabled={disabled} placeholder={range ? `${range[0]}–${range[1]}` : 'Unknown'}
        onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-full rounded-md border border-transparent px-2 py-1 text-sm hover:border-slate-300 focus:border-[#002C4B] focus:outline-none" />
      {range && value === null && <p className="px-2 text-[11px] text-slate-500">Stated as a range</p>}
    </div>
  );
}
