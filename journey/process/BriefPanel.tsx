// The brief (docs/effort-first-plan.md, part A), at the top of the Process stage: what this is, whether
// the work is done today, what kind of thing it is, the applications, what the team has in mind and the
// documents wanted. Each line read from the sources shows its passage; a person confirms the whole brief
// with one click or changes a line. Lines the sources are silent on say "Not stated" and are never
// filled in for the person. Rules and words: domain/plan/delivery.ts; edits: setBriefFact, confirmBrief.
import React from 'react';
import type { DoneToday, InMind, PlannedDoc, ProcessBrief, WorkKind } from '../../domain/processModel/types.ts';
import { confirmBrief, setBriefFact } from '../../domain/processModel/patch.ts';
import { DONE_TODAY, IN_MIND, PLANNED_DOCS, WORK_KINDS } from '../../domain/processModel/validate.ts';
import { briefLines, DOC_LABEL, DONE_TODAY_LABEL, hasBrief, IN_MIND_LABEL, WORK_KIND_LABEL, type BriefLine } from '../../domain/plan/delivery.ts';
import type { ModelEditor } from './useModelEditor.ts';
import { Button, cx, Tag } from '../ui.tsx';

const STATE: Record<BriefLine['state'], { text: string; tone: 'info' | 'ok' | 'neutral' }> = {
  read: { text: 'From the sources', tone: 'info' },
  confirmed: { text: 'Confirmed', tone: 'ok' },
  unknown: { text: 'Not stated', tone: 'neutral' },
};
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';

export function BriefPanel({ editor, canEdit, sourceTitle, reading, onRead }: {
  editor: ModelEditor; canEdit: boolean; sourceTitle: (key: string) => string;
  /** Reading the brief from the sources, when the server can (part A's reading task). */
  reading?: boolean; onRead?: () => void;
}) {
  const m = editor.model;
  const lines = briefLines(m);
  const toConfirm = lines.filter(l => l.key !== 'applications' && l.state === 'read').length;
  // Open while any line is to confirm or still missing; folded once every line is confirmed.
  const [open, setOpen] = React.useState(() => lines.some(l => l.key !== 'applications' && l.state !== 'confirmed'));
  const [editing, setEditing] = React.useState<BriefLine['key'] | null>(null);
  const summary = lines.find(l => l.key === 'summary')?.text;

  return (
    <section className="mb-5 rounded-xl border border-slate-200 bg-white" aria-label="The brief" data-testid="brief">
      <button type="button" className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-900">The brief</span>
          <span className="mt-0.5 block text-sm leading-6 text-slate-600" data-testid="brief-state">
            {!hasBrief(m) ? 'Not read yet: what this is, whether the work is done today, and what is wanted.'
              : toConfirm ? `${toConfirm} ${toConfirm === 1 ? 'line' : 'lines'} read from your sources to confirm.`
              : summary ?? 'Confirmed.'}
          </span>
        </span>
        <span className="mt-1 text-xs text-slate-500" aria-hidden>{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-5 pb-5 pt-3">
          <dl className="divide-y divide-slate-100">
            {lines.map(l => (
              <div key={l.key} className="grid gap-1 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4" data-testid={`brief-${l.key}`}>
                <dt className="text-sm font-medium text-slate-600">{l.label}</dt>
                <dd className="min-w-0">
                  {editing === l.key && l.key !== 'applications' ? (
                    <LineEditor k={l.key} brief={m.meta.brief ?? {}} onCancel={() => setEditing(null)}
                      onSave={async (value, words) => { if (await editor.apply(mm => setBriefFact(mm, { fact: l.key as keyof ProcessBrief, value: value as never }), `Brief: ${l.label.toLowerCase()} ${words}`)) setEditing(null); }} />
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cx('text-sm leading-6', l.text ? 'text-slate-900' : 'text-slate-500')}>{l.text ?? 'Not stated in the sources.'}</span>
                        <Tag tone={STATE[l.state].tone}>{l.key === 'applications' && l.state === 'read' ? 'From the process' : STATE[l.state].text}</Tag>
                        {canEdit && l.key !== 'applications' && <button type="button" className="text-xs font-medium text-slate-500 hover:text-slate-900 hover:underline" onClick={() => setEditing(l.key)}>{l.text ? 'Change' : 'Add'}</button>}
                      </div>
                      {l.fact?.sources[0] && l.state !== 'unknown' && (
                        <p className="mt-1 text-xs leading-5 text-slate-500">“{l.fact.sources[0].excerpt}” <span>({sourceTitle(l.fact.sources[0].sourceId)})</span></p>
                      )}
                      {l.key === 'applications' && <p className="mt-1 text-xs text-slate-500">Kept under Roles and systems below.</p>}
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {canEdit && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {toConfirm > 0 && <Button variant="accent" disabled={editor.saving} onClick={() => editor.apply(confirmBrief, 'Confirmed the brief')}>Confirm the brief</Button>}
              {onRead && <Button variant="secondary" disabled={reading} onClick={onRead}>{reading ? 'Reading your sources…' : hasBrief(m) ? 'Read it again from the sources' : 'Read it from the sources'}</Button>}
              <span className="text-xs text-slate-500">Confirming keeps each passage. Lines the sources do not state stay open until someone fills them in.</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function LineEditor({ k, brief, onSave, onCancel }: {
  k: Exclude<BriefLine['key'], 'applications'>; brief: ProcessBrief;
  onSave: (value: unknown, words: string) => void; onCancel: () => void;
}) {
  const cur = brief[k]?.status !== 'unknown' ? brief[k]?.value ?? null : null;
  const [text, setText] = React.useState(typeof cur === 'string' ? cur : '');
  const [pick, setPick] = React.useState<string>(typeof cur === 'string' ? cur : '');
  const [many, setMany] = React.useState<string[]>(Array.isArray(cur) ? cur : []);
  const toggle = (v: string) => setMany(xs => (xs.includes(v) ? xs.filter(x => x !== v) : [...xs, v]));
  const buttons = (value: unknown, words: string, ok: boolean) => (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button disabled={!ok} onClick={() => onSave(value, words)}>Save</Button>
      <Button variant="ghost" onClick={onCancel}>Cancel</Button>
    </div>
  );
  if (k === 'summary') {
    return <div><textarea aria-label="What this is" rows={2} maxLength={400} value={text} onChange={e => setText(e.target.value)} className={input} />{buttons(text.trim(), 'set', text.trim().length > 0)}</div>;
  }
  if (k === 'doneToday' || k === 'kind') {
    const options = k === 'doneToday' ? DONE_TODAY.map(v => [v, DONE_TODAY_LABEL[v as DoneToday]]) : WORK_KINDS.map(v => [v, WORK_KIND_LABEL[v as WorkKind]]);
    return (
      <div>
        <select aria-label={k === 'doneToday' ? 'Done today?' : 'What kind of thing'} value={pick} onChange={e => setPick(e.target.value)} className={input}>
          <option value="">Choose</option>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {buttons(pick, `set to ${options.find(o => o[0] === pick)?.[1] ?? ''}`, Boolean(pick))}
      </div>
    );
  }
  const options = k === 'inMind' ? IN_MIND.map(v => [v, IN_MIND_LABEL[v as InMind]]) : PLANNED_DOCS.map(v => [v, DOC_LABEL[v as PlannedDoc]]);
  return (
    <fieldset>
      <legend className="sr-only">{k === 'inMind' ? 'What the team has in mind' : 'Documents wanted'}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map(([v, l]) => (
          <label key={v} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="h-4 w-4 accent-[#002C4B]" checked={many.includes(v)} onChange={() => toggle(v)} />{l}</label>
        ))}
      </div>
      {buttons(options.map(o => o[0]).filter(v => many.includes(v)), 'set', many.length > 0)}
    </fieldset>
  );
}
