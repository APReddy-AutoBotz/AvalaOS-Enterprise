// Open questions (answered inline; an answer about a field writes that field as confirmed),
// missing information found by rule, and conflicts between sources (the person picks the value).
import React from 'react';
import { addQuestion, answerQuestion, resolveConflict } from '../../domain/processModel/patch.ts';
import { getElement, untrackedGaps } from '../../domain/processModel/selectors.ts';
import type { Conflict, ElementTarget, OpenQuestion, ProcessModel } from '../../domain/processModel/types.ts';
import { Button, EmptyState } from '../ui.tsx';
import type { TabContext } from './ProcessEditor.tsx';
import { Select, SourceList } from './widgets.tsx';

/** What a question is about, in words. */
export function targetLabel(m: ProcessModel, t: ElementTarget): string {
  const el = getElement(m, t) as Record<string, any> | undefined;
  const name = t.kind === 'meta' ? 'The process' : el?.name ?? el?.question ?? el?.label ?? '';
  const field: Record<string, string> = { roleIds: 'who does it', systemIds: 'systems used', access: 'access', value: 'value', objective: 'objective', owner: 'owner' };
  return [name, t.field ? field[t.field] ?? t.field : ''].filter(Boolean).join(' · ');
}

type ValueKind = 'role' | 'system' | 'text' | 'number' | null;
function valueKind(t: ElementTarget): ValueKind {
  if (t.kind === 'step' && t.field === 'roleIds') return 'role';
  if (t.kind === 'step' && t.field === 'systemIds') return 'system';
  if (t.kind === 'meta' && (t.field === 'objective' || t.field === 'owner')) return 'text';
  if (t.kind === 'metric' && t.field === 'value') return 'number';
  return null;
}

export function QuestionsTab({ model, editor, canEdit }: TabContext) {
  const open = model.openQuestions.filter(q => q.status === 'open');
  const answered = model.openQuestions.filter(q => q.status !== 'open');
  const missing = untrackedGaps(model);
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="font-display text-sm font-semibold text-slate-900">Open questions</h3>
        {open.length === 0 ? <p className="text-sm text-slate-500">No open questions.</p> : (
          <ul className="space-y-3">{open.map(q => <React.Fragment key={q.id}><QuestionCard q={q} model={model} canEdit={canEdit} onAnswer={(answer, value) => editor.apply(m => answerQuestion(m, { questionId: q.id, answer, ...(value !== undefined ? { value } : {}) }), `Answered: ${q.question}`)} /></React.Fragment>)}</ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-display text-sm font-semibold text-slate-900">Missing information</h3>
        <p className="text-xs text-slate-500">Found by checking the model: what the assessment and documents will need.</p>
        {missing.length === 0 ? <p className="text-sm text-slate-500">Nothing missing that the checks can see.</p> : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {missing.map((g, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5" data-testid="gap-row">
                <span className="text-sm text-slate-800">{g.label}</span>
                {canEdit && <Button variant="ghost" onClick={() => editor.apply(m => addQuestion(m, { target: g.target, question: g.label }), `Asked: ${g.label}`)}>Track as question</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {answered.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-display text-sm font-semibold text-slate-900">Answered</h3>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {answered.map(q => (
              <li key={q.id} className="px-4 py-2.5 text-sm" data-testid="answered-question">
                <p className="text-slate-800">{q.question}</p>
                <p className="mt-0.5 text-slate-600"><span className="font-semibold">Answer:</span> {q.answer ?? (q.status === 'deferred' ? 'Deferred' : '')}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function QuestionCard({ q, model, canEdit, onAnswer }: { q: OpenQuestion; model: ProcessModel; canEdit: boolean; onAnswer: (answer: string, value?: unknown) => Promise<boolean> }) {
  const kind = valueKind(q.target);
  const [text, setText] = React.useState('');
  const [pick, setPick] = React.useState('');
  const options = kind === 'role' ? model.roles : kind === 'system' ? model.systems : [];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    let answer = text.trim();
    let value: unknown;
    if (kind === 'role' || kind === 'system') {
      if (!pick) return;
      const name = options.find(o => o.id === pick)?.name ?? '';
      value = [pick];
      answer = answer || name;
    } else if (kind === 'text') {
      if (!answer) return;
      value = answer;
    } else if (kind === 'number') {
      const n = Number(answer.replace(/,/g, ''));
      if (!answer || !Number.isFinite(n)) return;
      value = n;
    } else if (!answer) return;
    if (await onAnswer(answer, value)) { setText(''); setPick(''); }
  };
  const ready = (kind === 'role' || kind === 'system') ? Boolean(pick) : Boolean(text.trim());
  return (
    <li className="rounded-xl border border-amber-200 bg-amber-50/40 p-4" data-testid="open-question">
      <p className="text-sm font-semibold text-slate-900">{q.question}</p>
      <p className="mt-0.5 text-xs text-slate-500">About: {targetLabel(model, q.target)}{q.whyItMatters ? ` · ${q.whyItMatters}` : ''}</p>
      {canEdit && (
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
          {(kind === 'role' || kind === 'system') && (
            <Select value={pick} label={`Answer to: ${q.question}`} onChange={setPick}
              options={[{ value: '', label: kind === 'role' ? 'Choose a role' : 'Choose a system' }, ...options.map(o => ({ value: o.id, label: o.name }))]} />
          )}
          <label className="flex-1 text-xs font-medium text-slate-600">{kind === 'role' || kind === 'system' ? 'Note (optional)' : 'Answer'}
            <input aria-label={kind === 'role' || kind === 'system' ? `Note for: ${q.question}` : `Answer to: ${q.question}`} value={text} onChange={e => setText(e.target.value)} inputMode={kind === 'number' ? 'decimal' : undefined}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" />
          </label>
          <Button type="submit" disabled={!ready}>Answer</Button>
        </form>
      )}
      {(kind === 'role' || kind === 'system') && options.length === 0 && <p className="mt-2 text-xs text-slate-500">Add {kind === 'role' ? 'roles' : 'systems'} under Roles and systems first.</p>}
    </li>
  );
}

export function ConflictsTab({ model, editor, canEdit, me, sourceTitle }: TabContext) {
  if (model.conflicts.length === 0) return <EmptyState title="No conflicts">When two sources give different values for the same thing, both are shown here for you to choose.</EmptyState>;
  return (
    <ul className="space-y-4">
      {model.conflicts.map(c => <React.Fragment key={c.id}><ConflictCard c={c} model={model} canEdit={canEdit} sourceTitle={sourceTitle}
        onChoose={(chosen, reason) => editor.apply(m => resolveConflict(m, { conflictId: c.id, chosen, by: me, reason, ...conflictValue(m, c, chosen) }), `Resolved: ${c.summary}`)} /></React.Fragment>)}
    </ul>
  );
}

/** The value to write when a conflict is about a field that holds a single number or text. */
function conflictValue(m: ProcessModel, c: Conflict, chosen: string): { value?: unknown } {
  const t = c.target;
  if (t.kind === 'metric' && t.field === 'value') {
    const n = Number(chosen.replace(/[, ]/g, '').match(/-?\d+(\.\d+)?/)?.[0]);
    return Number.isFinite(n) ? { value: n } : {};
  }
  const el = getElement(m, t) as Record<string, unknown> | undefined;
  if (t.field && el && typeof el[t.field] === 'string' && t.kind !== 'meta') return { value: chosen };
  return {};
}

function ConflictCard({ c, model, canEdit, onChoose, sourceTitle }: { c: Conflict; model: ProcessModel; canEdit: boolean; onChoose: (chosen: string, reason: string) => Promise<boolean>; sourceTitle: (id: string) => string }) {
  const [reason, setReason] = React.useState('');
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4" data-testid="conflict">
      <p className="text-sm font-semibold text-slate-900">{c.summary}</p>
      <p className="mt-0.5 text-xs text-slate-500">About: {targetLabel(model, c.target)}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {c.values.map((v, i) => (
          <div key={i} className={`rounded-lg border p-3 ${c.resolution?.chosen === v.value ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}>
            <p className="text-sm font-semibold text-slate-900">{v.value}</p>
            <div className="mt-2"><SourceList sources={v.sources} sourceTitle={sourceTitle} /></div>
            {canEdit && !c.resolution && <Button className="mt-3" variant="secondary" onClick={() => onChoose(v.value, reason.trim() || 'Chosen in review')}>Use this value</Button>}
          </div>
        ))}
      </div>
      {c.resolution ? (
        <p className="mt-3 text-sm text-emerald-800"><span className="font-semibold">Resolved:</span> {c.resolution.chosen}. {c.resolution.reason}</p>
      ) : canEdit && (
        <label className="mt-3 block text-xs font-medium text-slate-600">Reason (optional)
          <input value={reason} onChange={e => setReason(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
      )}
    </li>
  );
}
