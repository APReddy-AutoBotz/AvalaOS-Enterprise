// The typical process on the Process stage (docs/effort-first-plan.md, part I):
// - the confirm pass: each typical step, then rule, then exception, one at a time, with "We do this",
//   "Ours is different" (their own wording, which makes it theirs) and "We don't" (taken out); then the
//   roles and applications, where an application the company does not have is taken out with "We don't use it";
// - with documents present, a comparison a person asks for: they pick a typical process and see the steps
//   it has that the sources do not mention, each with "Add as typical". Avala OS never picks the typical
//   process itself (owner, 16 November 2026). Nothing is added or confirmed without a person's click.
// Rules: domain/reference/typical.ts; edits: confirmTypical, dropTypical, addTypicalStep.
import React from 'react';
import { addTypicalStep, confirmTypical, confirmTypicalRest, dropTypical } from '../../domain/processModel/patch.ts';
import { REFERENCES, referenceById, restToConfirm, toConfirm, typicalChecklist, typicalCounts } from '../../domain/reference/typical.ts';
import type { ModelEditor } from './useModelEditor.ts';
import { Button, Tag } from '../ui.tsx';

const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';
const KIND = { step: 'Step', rule: 'Rule', exception: 'Exception' } as const;

export function TypicalPanel({ editor, canEdit }: { editor: ModelEditor; canEdit: boolean }) {
  const m = editor.model;
  const queue = toConfirm(m);
  const counts = typicalCounts(m);
  // A comparison only when a person asks for one and picks the typical process to compare with.
  const [comparing, setComparing] = React.useState(false);
  const [compareId, setCompareId] = React.useState('');
  const canCompare = canEdit && !m.meta.startedFrom && m.steps.some(st => st.status !== 'typical');
  const ref = comparing && canCompare ? referenceById(compareId) : null;
  const checklist = ref ? typicalChecklist(m, ref) : [];
  const [skipped, setSkipped] = React.useState<string[]>([]);
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState('');
  const [detail, setDetail] = React.useState('');
  const [names, setNames] = React.useState<Record<string, string>>({});
  const rest = restToConfirm(m);
  // Counted from the record, so an application no step uses still brings the last card up (confirming it takes it out).
  const restLeft = counts.role + counts.system + counts.gateway + counts.event;
  const pending = queue.filter(x => !skipped.includes(`${x.kind}:${x.id}`));
  const item = pending[0];
  React.useEffect(() => { setEditing(false); setName(item?.name ?? ''); setDetail(''); }, [item?.kind, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!counts.total && !canCompare) return null;
  if (!counts.total && !comparing) {
    return (
      <p className="mb-5 text-sm text-slate-600" data-testid="typical-compare-offer">
        Want a cross-check? <button type="button" className="font-medium text-[#002C4B] underline" onClick={() => setComparing(true)}>Compare with a typical process</button>
      </p>
    );
  }
  const done = counts.total ? `${counts.total} typical ${counts.total === 1 ? 'item' : 'items'} to confirm` : '';
  const who = (stepId: string) => {
    const st = m.steps.find(x => x.id === stepId);
    if (!st) return '';
    const roles = st.roleIds.map(id => m.roles.find(r => r.id === id)?.name).filter(Boolean);
    const apps = st.systemIds.map(id => m.systems.find(x => x.id === id)?.name).filter(Boolean);
    return [roles.length ? `By ${roles.join(', ')}` : '', apps.length ? `in ${apps.join(', ')}` : ''].filter(Boolean).join(' ');
  };
  const restNamed = (id: string, old: string) => names[id] ?? old;
  const placeholderLeft = rest.systems.some(x => /^Your /.test(restNamed(x.id, x.name).trim()) || !restNamed(x.id, x.name).trim());

  return (
    <section className="mb-5 rounded-xl border border-orange-200 bg-orange-50/40 p-5" aria-label="Typical process" data-testid="typical-panel">
      {counts.total > 0 && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900" data-testid="typical-count">{done}</h3>
            <span className="text-xs text-slate-600">{counts.step} {counts.step === 1 ? 'step' : 'steps'}, {counts.rule} {counts.rule === 1 ? 'rule' : 'rules'}, {counts.exception} {counts.exception === 1 ? 'exception' : 'exceptions'}, then the roles, applications and decision points</span>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">These come from a typical process, not from your sources or your people. Until confirmed, documents mark them "Typical, not confirmed" and the assessment is provisional.</p>
          {item && canEdit ? (
            <article className="mt-4 rounded-lg border border-slate-200 bg-white p-4" data-testid="typical-item">
              <p className="flex items-center gap-2 text-xs font-medium text-slate-500">{KIND[item.kind]} {queue.indexOf(item) + 1} of {queue.length}<Tag tone="neutral">Typical</Tag></p>
              {!editing ? (
                <>
                  <p className="mt-1 text-sm font-semibold text-slate-900" data-testid="typical-name">{item.name}</p>
                  {item.detail && <p className="mt-1 text-sm leading-6 text-slate-600">{item.detail}</p>}
                  {item.kind === 'step' && who(item.id) && <p className="mt-1 text-xs text-slate-600">{who(item.id)}</p>}
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
          ) : item ? null : queue.length > 0 ? (
            <p className="mt-3 text-sm text-slate-600">{skipped.length} skipped for now. <button type="button" className="font-medium text-[#002C4B] underline" onClick={() => setSkipped([])}>Go through them again</button></p>
          ) : canEdit && restLeft > 0 ? (
            <article className="mt-4 rounded-lg border border-slate-200 bg-white p-4" data-testid="typical-rest">
              <p className="flex items-center gap-2 text-xs font-medium text-slate-500">Last: the roles, applications and decision points<Tag tone="neutral">Typical</Tag></p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                They connect the steps you confirmed{rest.gateways ? `: ${rest.gateways} ${rest.gateways === 1 ? 'decision point' : 'decision points'}` : ''}{rest.events ? `${rest.gateways ? ' and' : ':'} ${rest.events} start and end ${rest.events === 1 ? 'point' : 'points'}` : ''}. Use your own names; an application still called "Your …" needs its real name.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {rest.roles.map(x => (
                  <label key={x.id} className="block text-xs font-medium text-slate-600">Role
                    <input className={`${input} mt-1`} value={restNamed(x.id, x.name)} onChange={e => setNames(n => ({ ...n, [x.id]: e.target.value }))} />
                  </label>
                ))}
                {rest.systems.map(x => (
                  <div key={x.id} data-testid="typical-app">
                    <label className="block text-xs font-medium text-slate-600">Application
                      <input className={`${input} mt-1`} value={restNamed(x.id, x.name)} onChange={e => setNames(n => ({ ...n, [x.id]: e.target.value }))} />
                    </label>
                    <button type="button" className="mt-1 text-xs font-medium text-[#002C4B] underline disabled:opacity-50" disabled={editor.saving} aria-label={`We don't use ${x.name}`}
                      onClick={() => editor.apply(mm => dropTypical(mm, { kind: 'system', id: x.id }), `Taken out: ${x.name} (we don't use it)`)}>We don't use it</button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="accent" disabled={placeholderLeft || editor.saving} onClick={() => editor.apply(mm => confirmTypicalRest(mm, { names }), 'Confirmed the roles, applications and decision points')}>These are right</Button>
                {placeholderLeft && <span className="text-xs text-slate-600">Give each application its real name, or say you don't use it.</span>}
              </div>
            </article>
          ) : null}
        </>
      )}
      {comparing && canCompare && (
        <div className={counts.total ? 'mt-5 border-t border-orange-200 pt-4' : ''} data-testid="typical-checklist">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="block text-sm font-semibold text-slate-900">Compare with a typical process
              <select className={`${input} mt-1 font-normal`} value={compareId} onChange={e => setCompareId(e.target.value)} data-testid="typical-compare-choice">
                <option value="">Choose one…</option>
                {REFERENCES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <Button variant="ghost" onClick={() => { setComparing(false); setCompareId(''); }}>Stop comparing</Button>
          </div>
          {!ref && <p className="mt-2 text-sm leading-6 text-slate-600">Pick the one closest to this process. If none is, leave it: nothing is compared or added.</p>}
          {ref && checklist.length === 0 && <p className="mt-2 text-sm leading-6 text-slate-600">Nothing to add: every step of a typical {ref.noun} is already in this process.</p>}
          {ref && checklist.length > 0 && (
            <>
              <p className="mt-2 text-sm leading-6 text-slate-600">{checklist.length} {checklist.length === 1 ? `step of a typical ${ref.noun} is` : `steps of a typical ${ref.noun} are`} not in your sources. Worth asking whether you do {checklist.length === 1 ? 'it' : 'them'}; nothing is added unless you add it, and an added step stays Typical until confirmed.</p>
              <ul className="mt-2 divide-y divide-orange-100">
                {checklist.map(c => {
                  const step = ref.steps.find(st => st.id === c.stepId)!;
                  return (
                    <li key={c.stepId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="text-sm text-slate-800"><span className="font-medium">{c.name}</span><span className="text-slate-600"> · {step.description}</span></span>
                      <Button variant="ghost" disabled={editor.saving} onClick={() => editor.apply(mm => addTypicalStep(mm, { step }), `Added as typical: ${c.name}`)}>Add as typical</Button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
      {!comparing && canCompare && counts.total > 0 && (
        <p className="mt-4 text-sm text-slate-600"><button type="button" className="font-medium text-[#002C4B] underline" onClick={() => setComparing(true)}>Compare with a typical process</button></p>
      )}
    </section>
  );
}
