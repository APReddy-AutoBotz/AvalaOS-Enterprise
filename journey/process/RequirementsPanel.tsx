// The requirements register beside the FRD: every requirement with its ID, and an editor for the
// wording, priority and acceptance criteria. An edit is kept on every regeneration; "Use the derived
// wording" hands it back to the model.
import React from 'react';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { Acceptance, Priority, ReqKind } from '../../domain/requirements/derive.ts';
import { editRequirement, keepRequirement, PRIORITY_LABEL, RequirementError, revertRequirement, type Requirement } from '../../domain/requirements/register.ts';
import { Button, cx, messageOf } from '../ui.tsx';

const KIND_LABEL: Record<ReqKind, string> = { BR: 'Business', FR: 'Functional', NFR: 'Non-functional' };
const input = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';

function Editor({ r, onSave, onCancel }: { r: Requirement; onSave: (r: Requirement) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = React.useState(r.title);
  const [statement, setStatement] = React.useState(r.statement);
  const [priority, setPriority] = React.useState<Priority | null>(r.priority);
  const [criteria, setCriteria] = React.useState<Acceptance[]>(r.acceptance.length ? r.acceptance : []);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    setBusy(true); setError(null);
    try { await onSave(editRequirement(r, { title, statement, priority, acceptance: criteria })); }
    catch (e) { setError(e instanceof RequirementError ? e.message : messageOf(e)); setBusy(false); }
  };
  const setC = (i: number, k: keyof Acceptance, v: string) => setCriteria(criteria.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200" data-testid="requirement-editor">
      <label className="grid gap-1 text-xs font-semibold text-slate-700">Title<input aria-label={`Title of ${r.code}`} value={title} onChange={e => setTitle(e.target.value)} className={input} /></label>
      <label className="grid gap-1 text-xs font-semibold text-slate-700">Requirement<textarea aria-label={`Statement of ${r.code}`} value={statement} rows={2} onChange={e => setStatement(e.target.value)} className={input} /></label>
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">Priority
        <select aria-label={`Priority of ${r.code}`} value={priority ?? ''} onChange={e => setPriority((e.target.value || null) as Priority | null)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-normal">
          <option value="">Not set</option>{(Object.keys(PRIORITY_LABEL) as Priority[]).map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
      </label>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-700">Acceptance criteria</p>
        {criteria.map((c, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            {(['given', 'when', 'then'] as const).map(k => <input key={k} aria-label={`${k[0].toUpperCase()}${k.slice(1)} ${i + 1} of ${r.code}`} placeholder={k[0].toUpperCase() + k.slice(1)} value={c[k]} onChange={e => setC(i, k, e.target.value)} className={input} />)}
            <button type="button" className="text-xs text-slate-600 hover:underline" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className="text-xs font-semibold text-[#002C4B] hover:underline" onClick={() => setCriteria([...criteria, { given: '', when: '', then: '' }])}>+ Add a criterion</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2"><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save requirement'}</Button><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </div>
  );
}

export function RequirementsPanel({ model, requirements, canEdit, onSave }: { model: ProcessModel; requirements: Requirement[]; canEdit: boolean; onSave: (r: Requirement) => Promise<void> }) {
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState<ReqKind>('FR');
  const shown = requirements.filter(r => r.kind === kind && r.state !== 'retired');
  const count = (k: ReqKind) => requirements.filter(r => r.kind === k && r.state === 'active').length;
  const removed = requirements.filter(r => r.state === 'source_removed').length;
  const review = requirements.filter(r => r.needsReview).length;
  const steps = (ids: string[]) => ids.map(id => model.steps.find(s => s.id === id)?.name).filter(Boolean).join(', ');
  return (
    <section className="rounded-xl border border-slate-200 bg-white" aria-label="Requirements" data-testid="requirements-panel">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left">
        <span>
          <span className="font-display text-base font-semibold text-slate-900">Requirements register</span>
          <span className="ml-3 text-sm text-slate-600" data-testid="requirements-counts">{count('BR')} business · {count('FR')} functional · {count('NFR')} non-functional{removed ? ` · ${removed} with source removed` : ''}{review ? ` · ${review} to review` : ''}</span>
        </span>
        <span className="text-sm font-semibold text-[#002C4B]">{open ? 'Hide' : canEdit ? 'Review and edit' : 'Show'}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-5 pb-5 pt-3">
          <p className="text-sm text-slate-600">Derived by rule from the process: each automated step, business rule, exception and control. IDs never change or get reused. Your edits stay when the process changes; a requirement whose step is removed is kept and marked.</p>
          <div role="tablist" aria-label="Requirement type" className="mt-3 inline-flex rounded-lg bg-slate-100 p-0.5">
            {(['BR', 'FR', 'NFR'] as ReqKind[]).map(k => <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={cx('rounded-md px-3 py-1 text-sm font-semibold', kind === k ? 'bg-white text-[#002C4B] shadow-sm' : 'text-slate-600')}>{KIND_LABEL[k]} ({count(k)})</button>)}
          </div>
          <ul className="mt-3 divide-y divide-slate-100">
            {shown.map(r => (
              <li key={r.code} className="py-3" data-testid="requirement">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="rounded-md bg-[#002C4B]/[0.06] px-2 py-0.5 font-mono text-xs font-semibold text-[#002C4B]">{r.code}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{r.title}
                      {r.edited && <span className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800">Edited</span>}
                      {r.needsReview && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900" data-testid="req-review">Needs review</span>}
                      {r.state === 'source_removed' && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">Source removed</span>}
                      {r.priority && <span className="ml-2 text-xs font-semibold text-slate-500">{PRIORITY_LABEL[r.priority]}</span>}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-700">{r.statement}</p>
                    <p className="mt-1 text-xs text-slate-500">{r.acceptance.length} acceptance {r.acceptance.length === 1 ? 'criterion' : 'criteria'}{r.stepIds.length ? ` · ${steps(r.stepIds)}` : ''}{r.traces.length ? ` · serves ${r.traces.join(', ')}` : ''}{r.gaps.length ? ` · ${r.gaps.length} open` : ''}</p>
                  </div>
                  {canEdit && editing !== r.code && <span className="flex gap-3">
                    <button type="button" className="text-sm font-semibold text-[#002C4B] hover:underline" aria-label={`Edit ${r.code}`} onClick={() => setEditing(r.code)}>Edit</button>
                    {r.edited && r.state === 'active' && <button type="button" className="text-sm text-slate-600 hover:underline" onClick={() => onSave(revertRequirement(r))}>Use the derived wording</button>}
                    {r.state === 'source_removed' && <button type="button" className="text-sm text-slate-600 hover:underline" onClick={() => onSave({ ...r, state: 'retired' })}>Retire</button>}
                  </span>}
                </div>
                {r.needsReview && r.derived && editing !== r.code && (
                  <div className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-inset ring-amber-200" data-testid="req-update">
                    <p><span className="font-semibold">The process changed since you edited this.</span> It would now read:</p>
                    <p className="mt-1 rounded bg-white px-2 py-1 text-slate-800">{r.derived.statement}</p>
                    {canEdit && <div className="mt-2 flex gap-2"><Button variant="secondary" onClick={() => onSave(keepRequirement(r))}>Keep mine</Button><Button variant="secondary" onClick={() => onSave(revertRequirement(r))}>Take update</Button></div>}
                  </div>
                )}
                {editing === r.code && <Editor r={r} onCancel={() => setEditing(null)} onSave={async x => { await onSave(x); setEditing(null); }} />}
              </li>
            ))}
            {!shown.length && <li className="py-6 text-center text-sm text-slate-500">None yet.</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
