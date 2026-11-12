// Closing the gaps: the open questions after triage, answered one at a time with the right input
// for each. Every answer is written to the process model, so the assessment and the documents
// update at once. Nothing is written without the person pressing save.
import React from 'react';
import type { AccessStatus, ProcessModel } from '../../domain/processModel/types.ts';
import { addQuestion, answerQuestion, closeQuestions, deferQuestion, reopenQuestions, routeException, setAccessStatus, updateFact, type OpResult } from '../../domain/processModel/patch.ts';
import type { JsonPatchOp } from '../../domain/processModel/jsonPatch.ts';
import { assessProcess } from '../../domain/assess/process.ts';
import { GROUP_LABEL, OWNER_LABEL, triage, type QGroup, type QOwner, type TriageItem } from '../../domain/questions/triage.ts';
import { Button, cx } from '../ui.tsx';
import type { ModelEditor } from './useModelEditor.ts';
import { AnswerFromNotes, type NotesContext } from './AnswerFromNotes.tsx';

type Op = (m: ProcessModel) => OpResult;
/** Runs operations in order as one edit. */
const all = (...ops: Op[]) => (m: ProcessModel): OpResult => ops.reduce<{ model: ProcessModel; patch: JsonPatchOp[] }>((cur, op) => { const r = op(cur.model); return { model: r.model, patch: [...cur.patch, ...r.patch] }; }, { model: m, patch: [] });

const GROUP_TONE: Record<QGroup, string> = { decides: 'bg-[#002C4B] text-white', signoff: 'bg-sky-100 text-sky-900', detail: 'bg-slate-100 text-slate-700' };
const ACCESS: [AccessStatus, string][] = [['unknown', 'Unknown'], ['confirmed', 'Can be used'], ['reported', 'Exists, not confirmed for use'], ['confirmed_absent', 'Not available']];
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';

/** Records an answer to an item, creating the stored question first when the item is a gap found by rule. */
const record = (item: TriageItem, answer: string, status: 'answered' | 'deferred' = 'answered'): Op => m => {
  if (item.questionIds.length) return closeQuestions(m, { questionIds: item.questionIds, answer, status });
  const added = addQuestion(m, { target: item.target, question: item.question });
  const closed = closeQuestions(added.model, { questionIds: [added.questionId], answer, status });
  return { model: closed.model, patch: [...added.patch, ...closed.patch] };
};


/** The edit an answer makes: the value written to its target and the question closed. Null when the answer is not complete. */
export function buildAnswer(item: TriageItem, model: ProcessModel, a: { pick?: string; text?: string; statuses?: Record<number, AccessStatus> }, sourceNote = ''): { op: Op; summary: string } | null {
  const t = item.target;
  const note = (a.text ?? '').trim();
  const withSource = (s: string) => (sourceNote ? `${s} (${sourceNote})` : s);
  switch (item.kind) {
    case 'role':
    case 'system': {
      const options = item.kind === 'role' ? model.roles : model.systems;
      const hit = options.find(o => o.id === a.pick);
      if (!hit) return null;
      const write: Op = t.kind === 'exception' ? m => routeException(m, { exceptionId: t.id!, roleId: hit.id }) : m => updateFact(m, { target: t, value: [hit.id] });
      return { op: all(write, record(item, withSource(note ? `${hit.name}. ${note}` : hit.name))), summary: `Answered: ${item.question}` };
    }
    case 'number': {
      const n = Number(note.replace(/,/g, ''));
      if (!note || !Number.isFinite(n) || n < 0) return null;
      return { op: item.questionIds.length === 1 ? m => answerQuestion(m, { questionId: item.questionIds[0], answer: withSource(note), value: n }) : all(m => updateFact(m, { target: t, value: n }), record(item, withSource(note))), summary: `Answered: ${item.question}` };
    }
    case 'text':
      if (!note) return null;
      return { op: all(m => updateFact(m, { target: t, value: note }), record(item, withSource(note))), summary: `Answered: ${item.question}` };
    case 'access': {
      const statuses = a.statuses ?? {};
      const changed = (item.interfaces ?? []).filter(x => statuses[x.index] && statuses[x.index] !== x.access);
      if (!changed.length && !note) return null;
      const settled = (item.interfaces ?? []).every(x => (statuses[x.index] ?? x.access) !== 'unknown');
      const ops: Op[] = changed.map(x => m => setAccessStatus(m, { systemId: t.id!, index: x.index, access: statuses[x.index] }));
      if (settled || note) ops.push(record(item, withSource(note || `Settled: ${changed.map(x => `${x.label.split(' (')[0]} ${ACCESS.find(y => y[0] === statuses[x.index])![1].toLowerCase()}`).join('; ')}`)));
      return { op: all(...ops), summary: `Interfaces of ${model.systems.find(s => s.id === t.id)?.name ?? 'a system'}` };
    }
    case 'free':
      if (!note) return null;
      return { op: record(item, withSource(note)), summary: `Answered: ${item.question}` };
  }
}

export function GapsAssistant({ model, editor, canEdit, onClose, notes }: { model: ProcessModel; editor: ModelEditor; canEdit: boolean; onClose?: () => void; notes?: NotesContext & { aiAvailable: boolean } }) {
  const [mode, setMode] = React.useState<'one' | 'notes'>('one');
  const t = React.useMemo(() => triage(model, assessProcess(model)), [model]);
  const [group, setGroup] = React.useState<QGroup | 'all'>('all');
  const [owner, setOwner] = React.useState<QOwner | 'all'>('all');
  const [showDeferred, setShowDeferred] = React.useState(false);
  const list = t.items.filter(i => (group === 'all' || i.group === group) && (owner === 'all' || i.owner === owner) && (showDeferred || !i.deferred));
  const [index, setIndex] = React.useState(0);
  const at = Math.min(index, Math.max(0, list.length - 1));
  const item = list[at];
  const open = t.items.filter(i => !i.deferred);
  const counts = (g: QGroup) => open.filter(i => i.group === g).length;

  return (
    <div className="space-y-5" data-testid="gaps-assistant">
      <section className="rounded-3xl bg-[#002C4B] p-6 text-white shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#FFBC03]">Close the gaps</p>
            <h3 className="mt-1.5 font-display text-2xl font-semibold" data-testid="gaps-count">{open.length} {open.length === 1 ? 'question' : 'questions'} to answer</h3>
            <p className="mt-1 text-sm text-slate-200">From {t.raw} raised: duplicates merged and what the model already holds set aside. Each answer updates the model, the assessment and the documents at once.</p>
          </div>
          {onClose && <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white ring-1 ring-white/30 hover:bg-white/10">Back to the document</button>}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {(['decides', 'signoff', 'detail'] as QGroup[]).map(g => (
            <button key={g} type="button" onClick={() => { setGroup(group === g ? 'all' : g); setIndex(0); }} aria-pressed={group === g}
              className={cx('rounded-2xl p-4 text-left ring-1 ring-inset transition', group === g ? 'bg-white text-[#002C4B] ring-white' : 'bg-white/[0.07] ring-white/10 hover:bg-white/[0.12]')}>
              <span className="font-display text-2xl font-semibold tabular-nums">{counts(g)}</span>
              <span className="mt-0.5 block text-sm">{GROUP_LABEL[g]}</span>
            </button>
          ))}
        </div>
      </section>

      {t.alreadyKnown.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3.5" data-testid="already-known">
          <p className="text-sm text-emerald-900"><span className="font-semibold">{t.alreadyKnown.length} {t.alreadyKnown.length === 1 ? 'question is' : 'questions are'} already answered by the model</span>, for example: {t.alreadyKnown[0].why}</p>
          {canEdit && <Button variant="secondary" onClick={() => editor.apply(all(...t.alreadyKnown.map(k => (m: ProcessModel) => closeQuestions(m, { questionIds: [k.questionId], answer: `Already recorded: ${k.why}` }))), `Closed ${t.alreadyKnown.length} questions the model already answers`)}>Close them</Button>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-slate-600">Who can answer
          <select aria-label="Who can answer" value={owner} onChange={e => { setOwner(e.target.value as QOwner | 'all'); setIndex(0); }} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm">
            <option value="all">Anyone</option>{(Object.keys(OWNER_LABEL) as QOwner[]).map(o => <option key={o} value={o}>{OWNER_LABEL[o]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-slate-600"><input type="checkbox" checked={showDeferred} onChange={e => setShowDeferred(e.target.checked)} />Include the ones set aside ({t.items.filter(i => i.deferred).length})</label>
        <span className="ml-auto text-xs text-slate-500" data-testid="save-state">{editor.saving ? 'Saving…' : ''}</span>
        {canEdit && notes?.aiAvailable && (
          <div role="tablist" aria-label="How to answer" className="inline-flex rounded-xl bg-slate-100 p-1">
            {([['one', 'One at a time'], ['notes', 'From notes or voice']] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={cx('rounded-lg px-3 py-1 text-sm font-semibold', mode === id ? 'bg-white text-[#002C4B] shadow-sm' : 'text-slate-600')}>{label}</button>
            ))}
          </div>
        )}
      </div>

      {mode === 'notes' && notes?.aiAvailable && canEdit ? <AnswerFromNotes model={model} items={list} editor={editor} ctx={notes} /> : <>

      {!item ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center" data-testid="gaps-done">
          <p className="font-display text-lg font-semibold text-slate-900">{open.length === 0 ? 'No open questions left' : 'Nothing left in this view'}</p>
          <p className="mt-1 text-sm text-slate-600">{open.length === 0 ? 'The documents now rest on answered facts. Questions set aside stay listed in each document until someone answers them.' : 'Change the filters to see the rest.'}</p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <QuestionCard key={item.key} item={item} model={model} canEdit={canEdit} position={`${at + 1} of ${list.length}`}
            onApply={(op, summary) => editor.apply(op, summary)}
            onSkip={() => setIndex((at + 1) % list.length)} onBack={at > 0 ? () => setIndex(at - 1) : undefined} />
          <ol className="max-h-[32rem] space-y-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 text-sm" aria-label="Questions">
            {list.map((x, i) => (
              <li key={x.key}><button type="button" onClick={() => setIndex(i)} className={cx('w-full rounded-lg px-3 py-2 text-left', i === at ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-700 hover:bg-slate-50')}>
                <span className="flex items-start gap-2"><span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', x.group === 'decides' ? 'bg-[#002C4B]' : x.group === 'signoff' ? 'bg-sky-400' : 'bg-slate-300')} />
                <span className="line-clamp-2">{x.question}{x.deferred && <span className="ml-1 text-xs font-normal text-slate-500">(set aside)</span>}</span></span>
              </button></li>
            ))}
          </ol>
        </div>
      )}
      </>}
    </div>
  );
}

function QuestionCard({ item, model, canEdit, position, onApply, onSkip, onBack }: {
  key?: React.Key; item: TriageItem; model: ProcessModel; canEdit: boolean; position: string;
  onApply: (op: Op, summary: string) => Promise<boolean>; onSkip: () => void; onBack?: () => void;
}) {
  const [text, setText] = React.useState('');
  const [pick, setPick] = React.useState('');
  const [statuses, setStatuses] = React.useState<Record<number, AccessStatus>>(() => Object.fromEntries((item.interfaces ?? []).map(x => [x.index, x.access])));
  const [assignee, setAssignee] = React.useState(item.assignedTo ?? '');
  const [mode, setMode] = React.useState<'answer' | 'later'>('answer');
  const t = item.target;
  const options = item.kind === 'role' ? model.roles : item.kind === 'system' ? model.systems : [];

  const answerOp = () => buildAnswer(item, model, { pick, text, statuses });
  const ready = answerOp() !== null;
  const save = async () => { const a = answerOp(); if (a) await onApply(a.op, a.summary); };

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="gap-question">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold tabular-nums text-slate-500">Question {position}</span>
        <span className={cx('rounded-full px-2.5 py-0.5 font-semibold', GROUP_TONE[item.group])}>{GROUP_LABEL[item.group]}</span>
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">Ask: {item.assignedTo ?? OWNER_LABEL[item.owner]}</span>
      </div>
      <h4 className="mt-3 font-display text-lg font-semibold leading-snug text-slate-900">{item.question}</h4>
      <p className="mt-1 text-xs text-slate-500">Updates: {item.affects.join(' · ')}</p>

      {canEdit && mode === 'answer' && (
        <div className="mt-5 space-y-3">
          {(item.kind === 'role' || item.kind === 'system') && (
            <select aria-label="Answer" value={pick} onChange={e => setPick(e.target.value)} className={input}>
              <option value="">{item.kind === 'role' ? 'Choose the role' : 'Choose the system'}</option>
              {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          {item.kind === 'access' && (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {item.interfaces!.map(x => (
                <li key={x.index} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="text-sm text-slate-800">{x.label}</span>
                  <select aria-label={`Status of ${x.label}`} value={statuses[x.index]} onChange={e => setStatuses({ ...statuses, [x.index]: e.target.value as AccessStatus })}
                    className={cx('rounded-md border px-2 py-1 text-xs', statuses[x.index] === 'unknown' ? 'border-amber-300 bg-amber-50' : 'border-slate-300 bg-white')}>
                    {ACCESS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          )}
          {item.kind === 'number'
            ? <input aria-label="Answer" inputMode="decimal" value={text} onChange={e => setText(e.target.value)} placeholder="A number" className={input} />
            : <textarea aria-label={item.kind === 'free' || item.kind === 'text' ? 'Answer' : 'Note (optional)'} rows={item.kind === 'free' ? 4 : 2} value={text} onChange={e => setText(e.target.value)}
                placeholder={item.kind === 'free' || item.kind === 'text' ? 'Type the answer as you would say it' : 'Anything worth recording with the answer'} className={input} />}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!ready} onClick={save}>Save answer</Button>
            <Button variant="ghost" onClick={onSkip}>Skip</Button>
            {onBack && <Button variant="ghost" onClick={onBack}>Back</Button>}
            <span className="flex-1" />
            <Button variant="ghost" onClick={() => onApply(record(item, 'Not applicable to this process.'), `Not applicable: ${item.question}`)}>Not applicable</Button>
            {item.deferred
              ? <Button variant="ghost" onClick={() => onApply(m => reopenQuestions(m, { questionIds: item.questionIds }), `Reopened: ${item.question}`)}>Reopen</Button>
              : <Button variant="ghost" onClick={() => setMode('later')}>Ask someone later</Button>}
          </div>
        </div>
      )}
      {canEdit && mode === 'later' && (
        <div className="mt-5 flex flex-wrap items-end gap-2">
          <label className="flex-1 text-xs font-semibold text-slate-600">Who should answer it
            <input aria-label="Who should answer it" value={assignee} onChange={e => setAssignee(e.target.value)} placeholder={OWNER_LABEL[item.owner]} className={cx(input, 'mt-1')} />
          </label>
          <Button onClick={() => onApply(m => deferQuestion(m, { questionIds: item.questionIds, owner: assignee || OWNER_LABEL[item.owner], gap: { target: item.target, question: item.question } }), `Set aside for ${assignee || OWNER_LABEL[item.owner]}: ${item.question}`)}>Set aside</Button>
          <Button variant="ghost" onClick={() => setMode('answer')}>Cancel</Button>
        </div>
      )}
    </article>
  );
}
