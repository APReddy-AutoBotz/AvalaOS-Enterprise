// The Process stage: the model as tables to review and correct. Every change is one operation from
// domain/processModel/patch.ts, saved at once; edited elements become "Confirmed".
import React from 'react';
import type { ProcessModel, RoleKind, SourceRef, SystemKind, TaskType } from '../../domain/processModel/types.ts';
import { addRole, addStep, addSystem, moveStep, ModelOpError, removeElement, removeStep, updateFact } from '../../domain/processModel/patch.ts';
import { openItemCount, orderedSteps, stepsForRole, stepsForSystem } from '../../domain/processModel/selectors.ts';
import { Button, cx, ErrorNote } from '../ui.tsx';
import type { ModelEditor } from './useModelEditor.ts';
import { ConfirmDelete, InlineText, RefChips, Select, SidePanel, SourceList, SourcesButton, StatusBadge, TableShell } from './widgets.tsx';
import { DataTab, ExceptionsTab, RulesTab } from './FactTabs.tsx';
import { ConflictsTab, QuestionsTab } from './QuestionsTab.tsx';

export const TASK_TYPES: { value: TaskType; label: string }[] = [
  { value: 'user', label: 'Person using a system' },
  { value: 'manual', label: 'Manual, no system' },
  { value: 'service', label: 'System on its own' },
  { value: 'business_rule', label: 'Automatic check' },
  { value: 'send', label: 'Sends to outside' },
  { value: 'receive', label: 'Receives from outside' },
];
export const ROLE_KINDS: { value: RoleKind; label: string }[] = [
  { value: 'person_role', label: 'Role' }, { value: 'team', label: 'Team' }, { value: 'external', label: 'External party' }, { value: 'system_actor', label: 'System actor' },
];
export const SYSTEM_KINDS: { value: SystemKind; label: string }[] = [
  { value: 'erp', label: 'ERP' }, { value: 'email', label: 'Email' }, { value: 'document_store', label: 'Document store' }, { value: 'spreadsheet', label: 'Spreadsheet' },
  { value: 'workflow', label: 'Workflow' }, { value: 'portal', label: 'Portal' }, { value: 'scanner', label: 'Scanner' }, { value: 'other', label: 'Other' },
];

export interface TabContext {
  model: ProcessModel;
  editor: ModelEditor;
  canEdit: boolean;
  me: string;
  sourceTitle(id: string): string;
  showSources(title: string, sources: SourceRef[]): void;
}

type TabId = 'steps' | 'roles' | 'rules' | 'exceptions' | 'data' | 'questions' | 'conflicts';

export function ProcessEditor({ editor, canEdit, me, sourceTitle }: { editor: ModelEditor; canEdit: boolean; me: string; sourceTitle: (id: string) => string }) {
  const model = editor.model;
  const [tab, setTab] = React.useState<TabId>('steps');
  const [panel, setPanel] = React.useState<{ title: string; sources: SourceRef[] } | null>(null);
  const openCount = openItemCount(model);
  const conflictCount = model.conflicts.filter(c => !c.resolution).length;
  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'steps', label: 'Steps', count: model.steps.length },
    { id: 'roles', label: 'Roles and systems', count: model.roles.length + model.systems.length },
    { id: 'rules', label: 'Rules and decisions', count: model.rules.length + model.gateways.length },
    { id: 'exceptions', label: 'Exceptions', count: model.exceptions.length },
    { id: 'data', label: 'Data and figures', count: model.dataObjects.length + model.meta.metrics.length },
    { id: 'questions', label: 'Open questions', count: openCount },
    { id: 'conflicts', label: 'Conflicts', count: conflictCount },
  ];
  const ctx: TabContext = { model, editor, canEdit, me, sourceTitle, showSources: (title, sources) => setPanel({ title, sources }) };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Parts of the process" className="flex flex-wrap gap-0.5 rounded-lg bg-slate-200/70 p-0.5">
          {tabs.map(t => (
            <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={cx('rounded-md px-3 py-1.5 text-sm font-semibold', tab === t.id ? 'bg-white text-[#002C4B] shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
              {t.label}
              {t.count !== undefined && t.count > 0 && <span className={cx('ml-1.5 text-xs tabular-nums', (t.id === 'questions' || t.id === 'conflicts') ? 'rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900' : 'font-normal text-slate-500')}>{t.count}</span>}
            </button>
          ))}
        </div>
        <p aria-live="polite" className="text-xs text-slate-500" data-testid="save-state">{editor.saving ? 'Saving…' : canEdit ? 'All changes saved' : 'Read only'}</p>
      </div>
      <div className="mt-3"><ErrorNote message={editor.error} /></div>
      <div role="tabpanel" aria-label={tabs.find(t => t.id === tab)!.label} className="mt-3">
        {tab === 'steps' && <StepsTab {...ctx} />}
        {tab === 'roles' && <RolesSystemsTab {...ctx} />}
        {tab === 'rules' && <RulesTab {...ctx} />}
        {tab === 'exceptions' && <ExceptionsTab {...ctx} />}
        {tab === 'data' && <DataTab {...ctx} />}
        {tab === 'questions' && <QuestionsTab {...ctx} />}
        {tab === 'conflicts' && <ConflictsTab {...ctx} />}
      </div>
      {panel && <SidePanel title={`Sources: ${panel.title}`} onClose={() => setPanel(null)}><SourceList sources={panel.sources} /></SidePanel>}
    </div>
  );
}

// ---------------------------------------------------------------- steps

function StepsTab({ model, editor, canEdit, showSources, sourceTitle }: TabContext) {
  const steps = orderedSteps(model);
  const roles = model.roles.map(r => ({ id: r.id, name: r.name }));
  const systems = model.systems.map(s => ({ id: s.id, name: s.name }));
  const [details, setDetails] = React.useState<string | null>(null);
  const set = (id: string, field: string, value: unknown, name: string, what: string) =>
    editor.apply(m => updateFact(m, { target: { kind: 'step', id, field }, value }), `${what} of "${name}"`);

  const move = (i: number, dir: -1 | 1) => {
    const s = steps[i], other = steps[i + dir];
    if (!other) return;
    editor.apply(m => moveStep(m, { stepId: s.id, ...(dir === -1 ? { before: other.id } : { after: other.id }) }), `Moved "${s.name}"`);
  };
  const open = steps.find(s => s.id === details);

  return (
    <div className="space-y-4">
      <TableShell head={['#', 'Step', 'Done by', 'Systems', 'Type', 'Status', '']}
        empty={steps.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No steps yet. Add sources to extract them, or add them here.</p> : undefined}>
        {steps.map((s, i) => (
          <tr key={s.id} data-testid="step-row" className="align-top">
            <td className="px-3 py-2.5 text-xs tabular-nums text-slate-400">{i + 1}</td>
            <td className="min-w-56 px-1 py-1">
              <InlineText value={s.name} label={`Name of step ${i + 1}`} disabled={!canEdit} onSave={v => set(s.id, 'name', v, s.name, 'Renamed')} />
              <button type="button" onClick={() => setDetails(s.id)} className="ml-2 text-xs text-slate-500 hover:text-[#002C4B]">Details</button>
            </td>
            <td className="px-3 py-2"><RefChips ids={s.roleIds} options={roles} label={`Roles for ${s.name}`} disabled={!canEdit} onChange={v => set(s.id, 'roleIds', v, s.name, 'Changed roles')} /></td>
            <td className="px-3 py-2"><RefChips ids={s.systemIds} options={systems} label={`Systems for ${s.name}`} disabled={!canEdit} onChange={v => set(s.id, 'systemIds', v, s.name, 'Changed systems')} /></td>
            <td className="px-3 py-2"><Select value={s.taskType} options={TASK_TYPES} label={`Type of ${s.name}`} disabled={!canEdit} onChange={v => set(s.id, 'taskType', v, s.name, 'Changed type')} /></td>
            <td className="px-3 py-2"><StatusBadge status={s.status} /><div><SourcesButton count={s.sources.length} what={s.name} onClick={() => showSources(s.name, s.sources)} /></div></td>
            <td className="whitespace-nowrap px-3 py-2 text-right">
              {canEdit && (
                <>
                  <button type="button" aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-25"><svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden><path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
                  <button type="button" aria-label={`Move ${s.name} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-25"><svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
                  <ConfirmDelete what={`step "${s.name}"`} onDelete={() => editor.apply(m => removeStep(m, { stepId: s.id }), `Deleted "${s.name}"`)} />
                </>
              )}
            </td>
          </tr>
        ))}
      </TableShell>
      {canEdit && <AddStep model={model} editor={editor} after={steps.at(-1)?.id} />}
      {open && (
        <SidePanel title={open.name} onClose={() => setDetails(null)}>
          <div>
            <p className="text-xs font-semibold text-slate-600">Description</p>
            <InlineText multiline value={open.description} label="Description" disabled={!canEdit} placeholder="What happens in this step" onSave={v => set(open.id, 'description', v, open.name, 'Described')} />
          </div>
          <div className="flex items-center gap-2"><StatusBadge status={open.status} /></div>
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-600">Sources</p>
            <SourceList sources={open.sources} />
          </div>
        </SidePanel>
      )}
    </div>
  );
}

function AddStep({ editor, after }: { model: ProcessModel; editor: ModelEditor; after?: string }) {
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<TaskType>('user');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const ok = await editor.apply(m => {
      try { return addStep(m, { step: { name: n, taskType: type }, ...(after ? { after } : {}) }); } catch (err) {
        // After a decision there is more than one path: add the step unlinked and let the person connect it.
        if (err instanceof ModelOpError && err.code === 'AMBIGUOUS_POSITION') return addStep(m, { step: { name: n, taskType: type } });
        throw err;
      }
    }, `Added "${n}"`);
    if (ok) setName('');
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-4">
      <label className="flex-1 text-xs font-medium text-slate-600">New step
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Verb and object, e.g. Check mandatory fields" className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs font-medium text-slate-600">Type
        <div className="mt-1"><Select value={type} options={TASK_TYPES} label="Type of new step" onChange={setType} /></div>
      </label>
      <Button type="submit" disabled={!name.trim()}>Add step</Button>
    </form>
  );
}

// ---------------------------------------------------------------- roles and systems

function RolesSystemsTab({ model, editor, canEdit, showSources }: TabContext) {
  const setRole = (id: string, field: string, value: unknown, name: string) => editor.apply(m => updateFact(m, { target: { kind: 'role', id, field }, value }), `Changed role ${name}`);
  const setSystem = (id: string, field: string, value: unknown, name: string) => editor.apply(m => updateFact(m, { target: { kind: 'system', id, field }, value }), `Changed system ${name}`);
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="font-display text-sm font-semibold text-slate-900">Roles</h3>
        <TableShell head={['Role', 'Kind', 'In scope', 'Steps', 'Status', '']}>
          {model.roles.map(r => (
            <tr key={r.id} data-testid="role-row">
              <td className="px-1 py-1"><InlineText value={r.name} label={`Name of role ${r.name}`} disabled={!canEdit} onSave={v => setRole(r.id, 'name', v, r.name)} /></td>
              <td className="px-3 py-2"><Select value={r.kind} options={ROLE_KINDS} label={`Kind of ${r.name}`} disabled={!canEdit} onChange={v => setRole(r.id, 'kind', v, r.name)} /></td>
              <td className="px-3 py-2"><input type="checkbox" aria-label={`${r.name} is in scope`} checked={r.inScope} disabled={!canEdit} onChange={e => setRole(r.id, 'inScope', e.target.checked, r.name)} /></td>
              <td className="px-3 py-2 text-slate-600">{stepsForRole(model, r.id).length}</td>
              <td className="px-3 py-2"><StatusBadge status={r.status} /> <SourcesButton count={r.sources.length} what={r.name} onClick={() => showSources(r.name, r.sources)} /></td>
              <td className="px-3 py-2 text-right"><ConfirmDelete what={`role ${r.name}`} disabled={!canEdit} onDelete={() => editor.apply(m => removeElement(m, { kind: 'role', id: r.id }), `Deleted role ${r.name}`)} /></td>
            </tr>
          ))}
        </TableShell>
        {canEdit && <AddNamed label="New role" kinds={ROLE_KINDS} button="Add role" onAdd={(name, kind) => editor.apply(m => addRole(m, { name, kind: kind as RoleKind }), `Added role ${name}`)} />}
      </section>

      <section className="space-y-2">
        <h3 className="font-display text-sm font-semibold text-slate-900">Systems</h3>
        <TableShell head={['System', 'Kind', 'Access', 'Steps', 'Status', '']}>
          {model.systems.map(s => (
            <tr key={s.id} data-testid="system-row" className="align-top">
              <td className="px-1 py-1"><InlineText value={s.name} label={`Name of system ${s.name}`} disabled={!canEdit} onSave={v => setSystem(s.id, 'name', v, s.name)} /></td>
              <td className="px-3 py-2"><Select value={s.kind} options={SYSTEM_KINDS} label={`Kind of ${s.name}`} disabled={!canEdit} onChange={v => setSystem(s.id, 'kind', v, s.name)} /></td>
              <td className="px-3 py-2">
                {s.access.length === 0 ? <span className="text-xs italic text-slate-500">Unknown</span> : (
                  <ul className="space-y-1">
                    {s.access.map((a, i) => (
                      <li key={i} className="text-xs text-slate-700">
                        <span className="font-semibold uppercase">{a.method}</span>{a.name ? ` · ${a.name}` : ''} · <AccessLabel access={a.access} />
                        <SourcesButton count={a.sources.length} what={`${s.name} ${a.method}`} onClick={() => showSources(`${s.name}: ${a.name || a.method}`, a.sources)} />
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="px-3 py-2 text-slate-600">{stepsForSystem(model, s.id).length}</td>
              <td className="px-3 py-2"><StatusBadge status={s.status} /> <SourcesButton count={s.sources.length} what={s.name} onClick={() => showSources(s.name, s.sources)} /></td>
              <td className="px-3 py-2 text-right"><ConfirmDelete what={`system ${s.name}`} disabled={!canEdit} onDelete={() => editor.apply(m => removeElement(m, { kind: 'system', id: s.id }), `Deleted system ${s.name}`)} /></td>
            </tr>
          ))}
        </TableShell>
        {canEdit && <AddNamed label="New system" kinds={SYSTEM_KINDS} button="Add system" onAdd={(name, kind) => editor.apply(m => addSystem(m, { name, kind: kind as SystemKind }), `Added system ${name}`)} />}
      </section>
    </div>
  );
}

function AccessLabel({ access }: { access: string }) {
  const map: Record<string, [string, string]> = {
    confirmed: ['Confirmed available', 'text-emerald-700'], reported: ['Reported, not confirmed', 'text-amber-700'],
    unknown: ['Unknown', 'text-slate-500'], confirmed_absent: ['Not available', 'text-red-700'],
  };
  const [label, tone] = map[access] ?? [access, 'text-slate-600'];
  return <span className={cx('font-medium', tone)}>{label}</span>;
}

export function AddNamed({ label, kinds, button, onAdd }: { label: string; kinds: { value: string; label: string }[]; button: string; onAdd: (name: string, kind: string) => Promise<boolean> }) {
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState(kinds[0].value);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async e => { e.preventDefault(); if (name.trim() && await onAdd(name.trim(), kind)) setName(''); }}>
      <label className="text-xs font-medium text-slate-600">{label}
        <input value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-64 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
      </label>
      <Select value={kind} options={kinds} label={`Kind of ${label.toLowerCase()}`} onChange={setKind} />
      <Button type="submit" variant="secondary" disabled={!name.trim()}>{button}</Button>
    </form>
  );
}
