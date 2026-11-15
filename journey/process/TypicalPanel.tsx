// The typical process on the Process stage (docs/effort-first-plan.md, part I):
// - the confirm pass: each typical step, then rule, then exception, one at a time, with "We do this",
//   "Ours is different" (their own wording, which makes it theirs) and "We don't" (taken out);
// - with documents present, the checklist: steps a typical process has that the sources do not mention,
//   each with "Add as typical". Nothing is added or confirmed without a person's click.
// Rules: domain/reference/typical.ts; edits: confirmTypical, dropTypical, addTypicalStep.
import React from 'react';
import { addTypicalStep, confirmTypical, dropTypical } from '../../domain/processModel/patch.ts';
import { matchReference, toConfirm, typicalChecklist, typicalCounts } from '../../domain/reference/typical.ts';
import type { ModelEditor } from './useModelEditor.ts';
import { Button, Tag } from '../ui.tsx';

const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';
const KIND = { step: 'Step', rule: 'Rule', exception: 'Exception' } as const;

export function TypicalPanel({ editor, canEdit, processName }: { editor: ModelEditor; canEdit: boolean; processName: string }) {
  const m = editor.model;
  const queue = toConfirm(m);
  const counts = typicalCounts(m);
  const ref = matchReference(processName) ?? matchReference(m.meta.name);
  const checklist = ref ? typicalChecklist(m, ref) : [];
  const [skipped, setSkipped] = React.useState<string[]>([]);
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState('');
  const [detail, setDetail] = React.useState('');
  const pending = queue.filter(x => !skipped.includes(`${x.kind}:${x.id}`));
  const item = pending[0];
  React.useEffect(() => { setEditing(false); setName(item?.name ?? ''); setDetail(''); }, [item?.kind, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!queue.length && !checklist.length) return null;
  const done = queue.length ? `${queue.length} typical ${queue.length === 1 ? 'item' : 'items'} to confirm` : '';

  return (
    <section className="mb-5 rounded-xl border border-orange-200 bg-orange-50/40 p-5" aria-label="Typical process" data-testid="typical-panel">
      {queue.length > 0 && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900" data-testid="typical-count">{done}</h3>
            <span className="text-xs text-slate-600">{counts.step} {counts.step === 1 ? 'step' : 'steps'}, {counts.rule} {counts.rule === 1 ? 'rule' : 'rules'}, {counts.exception} {counts.exception === 1 ? 'exception' : 'exceptions'} still typical</span>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">These come from a typical process, not from your sources or your people. Until confirmed, documents mark them "Typical, not confirmed" and the assessment is provisional.</p>
          {item && canEdit ? (
            <article className="mt-4 rounded-lg border border-slate-200 bg-white p-4" data-testid="typical-item">
              <p className="flex items-center gap-2 text-xs font-medium text-slate-500">{KIND[item.kind]} {queue.indexOf(item) + 1} of {queue.length}<Tag tone="neutral">Typical</Tag></p>
              {!editing ? (
                <>
                  <p className="mt-1 text-sm font-semibold text-slate-900" data-testid="typical-name">{item.name}</p>
                  {item.detail && <p className="mt-1 text-sm leading-6 text-slate-600">{item.detail}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="accent" disabled={editor.saving} onClick={() => editor.apply(mm => confirmTypical(mm, { kind: item.kind, id: item.id }), `Confirmed: ${item.name} (we do this)`)}>We do this</Button>
                    <Button variant="secondary" onClick={() => setEditing(true)}>Ours is different</Button>
                    <Button variant="secondary" disabled={editor.saving} onClick={() => editor.apply(mm => dropTypical(mm, { kind: item.kind, id: item.id }), `Taken out: ${item.name} (we don't do this)`)}>We don't</Button>
                    <Button variant="ghost" onClick={() => setSkipped(s => [...s, `${item.kind}:${item.id}`])}>Skip for now</Button>
                  </div>
                </>
              ) : (
                <div className="mt-2 space-y-2">
                  <label className="block text-xs font-medium text-slate-600">How you call it<input className={`${input} mt-1`} value={name} onChange={e => setName(e.target.value)} /></label>
                  <label className="block text-xs font-medium text-slate-600">{item.kind === 'step' ? 'What you do' : item.kind === 'rule' ? 'What happens' : 'How you handle it'} <span className="font-normal text-slate-500">(optional)</span>
                    <textarea className={`${input} mt-1`} rows={2} value={detail} onChange={e => setDetail(e.target.value)} placeholder={item.detail} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={!name.trim() || editor.saving} onClick={() => editor.apply(mm => confirmTypical(mm, { kind: item.kind, id: item.id, name, detail }), `Confirmed in our words: ${name.trim()}`)}>Save ours</Button>
                    <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </article>
          ) : item ? null : (
            <p className="mt-3 text-sm text-slate-600">{skipped.length} skipped for now. <button type="button" className="font-medium text-[#002C4B] underline" onClick={() => setSkipped([])}>Go through them again</button></p>
          )}
        </>
      )}
      {checklist.length > 0 && ref && (
        <div className={queue.length ? 'mt-5 border-t border-orange-200 pt-4' : ''} data-testid="typical-checklist">
          <h3 className="text-sm font-semibold text-slate-900">Compared with a typical {ref.name.charAt(0).toLowerCase() + ref.name.slice(1)}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">{checklist.length} {checklist.length === 1 ? 'step it has is' : 'steps it has are'} not in your sources. Worth asking whether you do {checklist.length === 1 ? 'it' : 'them'}; nothing is added unless you add it, and an added step stays Typical until confirmed.</p>
          <ul className="mt-2 divide-y divide-orange-100">
            {checklist.map(c => {
              const step = ref.steps.find(s => s.id === c.stepId)!;
              return (
                <li key={c.stepId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-sm text-slate-800"><span className="font-medium">{c.name}</span><span className="text-slate-500"> · {step.description}</span></span>
                  {canEdit && <Button variant="ghost" disabled={editor.saving} onClick={() => editor.apply(mm => addTypicalStep(mm, { step }), `Added as typical: ${c.name}`)}>Add as typical</Button>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
