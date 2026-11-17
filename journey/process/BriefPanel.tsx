// The brief (docs/effort-first-plan.md, part A), at the top of the Process stage: what this is, whether
// the work is done today, what kind of thing it is, the applications, what the team has in mind and the
// documents wanted. Each line read from the sources shows its passage; a person confirms the whole brief
// with one click or changes a line. Lines the sources are silent on say "Not stated" and are never
// filled in for the person. Rules and words: domain/plan/delivery.ts; edits: setBriefFact, confirmBrief.
import React from 'react';
import type { DoneToday, InMind, PlannedDoc, ProcessBrief, ProcessModel, WorkKind } from '../../domain/processModel/types.ts';
import { confirmBrief, decideApproach, removeDecidedApproach, setBriefFact, setPurpose, updateFact, type OpResult } from '../../domain/processModel/patch.ts';
import { APPROACH_LABEL } from '../../domain/assess/scoring.ts';
import { decidedBy } from '../../domain/assess/decided.ts';
import { PURPOSE_LABEL, PURPOSE_WHAT, PURPOSES, purposeOf, type PurposeValue } from '../../domain/plan/purpose.ts';
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

export function BriefPanel({ editor, canEdit, sourceTitle, reading, onRead, purpose }: {
  editor: ModelEditor; canEdit: boolean; sourceTitle: (key: string) => string;
  /** Reading the brief from the sources, when the server can (part A's reading task). */
  reading?: boolean; onRead?: () => void;
  /** "What do you want from this process?", when the organisation uses the documents: who I am, and people's names by id. */
  purpose?: { meId: string | null; names: Record<string, string>; onSwitched?: (before: ProcessModel, after: ProcessModel) => Promise<string | null> };
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
          {purpose && <dl><PurposeLine editor={editor} canEdit={canEdit} meId={purpose.meId} names={purpose.names} onSwitched={purpose.onSwitched} /></dl>}
          <dl className="divide-y divide-slate-100">
            {lines.map(l => (
              <div key={l.key} className="grid gap-1 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4" data-testid={`brief-${l.key}`}>
                <dt className="text-sm font-medium text-slate-600">{l.label}</dt>
                <dd className="min-w-0">
                  {editing === l.key && l.key !== 'applications' ? (
                    <LineEditor k={l.key} brief={m.meta.brief ?? {}} systems={m.systems.map(x => [x.id, x.name] as [string, string])} onCancel={() => setEditing(null)}
                      onSave={async (value, words) => { if (await editor.apply(mm => setBriefFact(mm, { fact: l.key as keyof ProcessBrief, value: value as never }), `Brief: ${l.label.toLowerCase()} ${words}`)) setEditing(null); }} />
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Unknown after a reading: the sources do not say. Never read nor given: not filled in yet. */}
                        <span className={cx('text-sm leading-6', l.text ? 'text-slate-900' : 'text-slate-500')}>{l.text ?? (l.fact || l.key === 'applications' ? 'Not stated in the sources.' : 'Not filled in yet.')}</span>
                        <Tag tone={STATE[l.state].tone}>{l.key === 'applications' && l.state === 'read' ? 'From the process' : l.state === 'unknown' && !l.fact && l.key !== 'applications' ? 'Not yet' : STATE[l.state].text}</Tag>
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
          {/* The objective and the owner: answered once in the open questions, and always changeable here
              (owner, 16 November 2026: a typed objective with spelling mistakes reached every document). */}
          <dl className="divide-y divide-slate-100 border-t border-slate-100" data-testid="brief-process-facts">
            {(['objective', 'owner'] as const).map(f => (
              <React.Fragment key={f}><MetaLine field={f} editor={editor} canEdit={canEdit} sourceTitle={sourceTitle} /></React.Fragment>
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

function LineEditor({ k, brief, systems, onSave, onCancel }: {
  k: Exclude<BriefLine['key'], 'applications'>; brief: ProcessBrief; systems: [string, string][];
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
  if (k === 'doneToday' || k === 'kind' || k === 'building') {
    const options = k === 'building' ? systems : k === 'doneToday' ? DONE_TODAY.map(v => [v, DONE_TODAY_LABEL[v as DoneToday]]) : WORK_KINDS.map(v => [v, WORK_KIND_LABEL[v as WorkKind]]);
    return (
      <div>
        <select aria-label={k === 'doneToday' ? 'Done today?' : k === 'building' ? 'What is being built' : 'What kind of thing'} value={pick} onChange={e => setPick(e.target.value)} className={input}>
          <option value="">{k === 'building' ? 'Choose the application being built' : 'Choose'}</option>
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

const META_LABEL = { objective: 'Objective', owner: 'Process owner' } as const;

/** The process's objective or owner: shown with where it came from, and changed by a person here. */
function MetaLine({ field, editor, canEdit, sourceTitle }: { field: 'objective' | 'owner'; editor: ModelEditor; canEdit: boolean; sourceTitle: (key: string) => string }) {
  const fact = editor.model.meta[field];
  const value = fact.status !== 'unknown' && fact.value ? String(fact.value) : null;
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(value ?? '');
  React.useEffect(() => { if (!editing) setText(value ?? ''); }, [value, editing]);
  const save = async () => {
    const next = text.trim();
    if (await editor.apply(m => updateFact(m, { target: { kind: 'meta', field }, value: next || null }), `${META_LABEL[field]} ${next ? 'changed' : 'cleared'}`)) setEditing(false);
  };
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4" data-testid={`brief-${field}`}>
      <dt className="text-sm font-medium text-slate-600">{META_LABEL[field]}</dt>
      <dd className="min-w-0">
        {editing ? (
          <div>
            {field === 'objective'
              ? <textarea aria-label={META_LABEL[field]} rows={3} maxLength={1000} value={text} onChange={e => setText(e.target.value)} className={input} />
              : <input aria-label={META_LABEL[field]} maxLength={200} value={text} onChange={e => setText(e.target.value)} className={input} />}
            <p className="mt-1 text-xs text-slate-500">Every document, requirement and new work item takes the new wording. Items already on the board keep theirs.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button disabled={editor.saving || text.trim() === (value ?? '')} onClick={save}>Save</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cx('text-sm leading-6', value ? 'text-slate-900' : 'text-slate-500')}>{value ?? 'Not stated yet.'}</span>
              <Tag tone={fact.status === 'user-confirmed' ? 'ok' : value ? 'info' : 'neutral'}>{fact.status === 'user-confirmed' ? 'Confirmed' : value ? 'From the sources' : 'Not yet'}</Tag>
              {canEdit && <button type="button" className="text-xs font-medium text-slate-500 hover:text-slate-900 hover:underline" onClick={() => setEditing(true)}>{value ? 'Change' : 'Add'}</button>}
            </div>
            {fact.sources[0] && fact.status !== 'user-confirmed' && (
              <p className="mt-1 text-xs leading-5 text-slate-500">“{fact.sources[0].excerpt}” <span>({sourceTitle(fact.sources[0].sourceId)})</span></p>
            )}
          </>
        )}
      </dd>
    </div>
  );
}

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); };

/**
 * What a person wants from the process (domain/plan/purpose.ts), with who answered and when. Avala OS
 * never works it out: until someone answers, the process is assessed and documented, as every process
 * was. Changing it changes only the answer; nothing else on the record is removed.
 */
export function PurposeLine({ editor, canEdit, meId, names, onSwitched }: { editor: ModelEditor; canEdit: boolean; meId: string | null; names: Record<string, string>;
  /** After the answer or the decided approach changed: the requirements are worked out again. Returns a line to show when that could not be saved. */
  onSwitched?: (before: ProcessModel, after: ProcessModel) => Promise<string | null> }) {
  const m = editor.model;
  const given = m.meta.purpose ?? null;
  const value = purposeOf(m);
  const [editing, setEditing] = React.useState(false);
  const [pick, setPick] = React.useState<PurposeValue>(value);
  const decided = m.meta.decidedApproach ?? null;
  // Starts empty: Avala OS never suggests an approach.
  const [approach, setApproach] = React.useState<DecidedChoice>(decided?.approach ?? '');
  const [reason, setReason] = React.useState(decided?.reason ?? '');
  const [note, setNote] = React.useState<string | null>(null);
  React.useEffect(() => { if (!editing) { setPick(value); setApproach(decided?.approach ?? ''); setReason(decided?.reason ?? ''); } }, [value, editing, decided]);
  const who = given?.by ? names[given.by] ?? null : null;
  const date = given ? when(given.at) : null;
  const sameDecision = Boolean(decided && decided.approach === approach && decided.reason === reason.trim());
  // Each switch is one edit; then the requirements are worked out again (domain/requirements/switch.ts).
  const run = async (op: (mm: ProcessModel) => OpResult, summary: string) => {
    const before = editor.model;
    const after = op(before).model;
    const ok = await editor.apply(op, summary);
    if (ok) setNote(onSwitched ? await onSwitched(before, after) : null);
    return ok;
  };
  const save = async () => {
    const at = new Date().toISOString();
    const ok = pick === 'decided'
      ? approach !== '' && await run(mm => decideApproach(mm, { approach, reason, by: meId, at }), `How it will be built is decided: ${APPROACH_LABEL[approach]}`)
      : await run(mm => setPurpose(mm, { value: pick, by: meId, at }), `What is wanted from the process: ${PURPOSE_LABEL[pick]}`);
    if (ok) setEditing(false);
  };
  // Removing the decision: each step goes back to the scoring's answer; "decided" goes back to "assess" in the same edit.
  const remove = () => run(mm => removeDecidedApproach(mm, { by: meId, at: new Date().toISOString() }), 'The decided approach removed');
  return (
    <div className="grid gap-1 border-b border-slate-100 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4" data-testid="brief-purpose">
      <dt className="text-sm font-medium text-slate-600">What do you want from this process?</dt>
      <dd className="min-w-0">
        {editing ? (
          <fieldset>
            <legend className="sr-only">What do you want from this process?</legend>
            <div className="space-y-2">
              {PURPOSES.map(p => (
                <label key={p} className="flex items-start gap-2 text-sm text-slate-800">
                  <input type="radio" name="purpose" className="mt-1 h-4 w-4 accent-[#002C4B]" checked={pick === p} onChange={() => setPick(p)} />
                  <span><span className="font-semibold">{PURPOSE_LABEL[p]}</span><span className="block text-xs leading-5 text-slate-600">{PURPOSE_WHAT[p]}</span></span>
                </label>
              ))}
            </div>
            {pick === 'decided' && <DecidedFields approach={approach} reason={reason} onApproach={setApproach} onReason={setReason} />}
            <p className="mt-2 text-xs text-slate-500">Nothing is deleted when you change this: answers, choices, edits and comments stay, and come back if you change it again.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button disabled={editor.saving || (pick === 'decided' ? approach === '' || !reason.trim() || (value === 'decided' && sameDecision) : pick === value && Boolean(given))} onClick={save}>Save</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </fieldset>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm leading-6 text-slate-900" data-testid="purpose-value">{PURPOSE_LABEL[value]}</span>
              <Tag tone={given ? 'ok' : 'neutral'}>{given ? 'Answered' : 'Not answered yet'}</Tag>
              {canEdit && <button type="button" className="text-xs font-medium text-slate-500 hover:text-slate-900 hover:underline" onClick={() => setEditing(true)}>Change</button>}
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {given ? `Answered by ${who ?? 'someone whose name is not recorded'}${date ? ` on ${date}` : ''}.` : 'Until someone answers, the process is assessed and documented.'}
            </p>
            {note && <p className="mt-1 text-xs leading-5 text-amber-900" role="status" data-testid="purpose-note">{note}</p>}
            {decided && (
              <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800 ring-1 ring-inset ring-slate-200" data-testid="decided-approach">
                <span className="font-semibold">{APPROACH_LABEL[decided.approach]}</span> for the whole process, decided {decidedBy(decided, names)}: "{decided.reason}".
                {value !== 'decided' && <span className="block text-xs text-slate-600">Still in effect for every step a person has not set themselves, until it is removed.</span>}
                {canEdit && <button type="button" className="ml-2 text-xs font-semibold text-[#002C4B] hover:underline" disabled={editor.saving} onClick={remove}>Remove the decided approach</button>}
              </div>
            )}
          </>
        )}
      </dd>
    </div>
  );
}

/** An approach chosen for the whole process, or none yet ('': the list starts empty). */
export type DecidedChoice = 'rpa' | 'api' | 'ai_assist' | 'agent' | '';

/** The approach decided for the whole process and the reason, both required (package 9). */
export function DecidedFields({ approach, reason, onApproach, onReason }: { approach: DecidedChoice; reason: string; onApproach: (a: DecidedChoice) => void; onReason: (r: string) => void }) {
  return (
    <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-[14rem_minmax(0,1fr)]" data-testid="decided-fields">
      <label className="text-xs font-medium text-slate-700">Which approach
        <select aria-label="Which approach" value={approach} onChange={e => onApproach(e.target.value as DecidedChoice)} className={`${input} mt-0.5`}>
          <option value="" disabled>Choose an approach</option>
          {(['rpa', 'api', 'ai_assist', 'agent'] as const).map(a => <option key={a} value={a}>{APPROACH_LABEL[a]}</option>)}
        </select>
      </label>
      <label className="text-xs font-medium text-slate-700">Why (required)
        <input aria-label="Why this approach" value={reason} maxLength={500} onChange={e => onReason(e.target.value)} className={`${input} mt-0.5`} placeholder="e.g. The client runs this platform for every process" />
      </label>
    </div>
  );
}
