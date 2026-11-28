// "Who does it?" and "Which application?" with someone not in the process yet (owner's walk, 28 November 2026;
// plan `claude/someone-else-plan-28-nov.md`): the roles (or applications) already in the process to choose from,
// then "Someone else" (or "Another application") with a name to type, and what Save will record. The rule is
// `namedChoice` / `namedRecordLine` / `buildAnswer` in `domain/questions/answer.ts`; nothing is saved here.
import React from 'react';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { TriageItem } from '../../domain/questions/triage.ts';
import { NAMED_KINDS, namedRecordLine, SOMEONE_ELSE, type Named } from '../../domain/questions/answer.ts';

export interface NamedValue { pick: string; named: Named }
export const emptyNamed = (): NamedValue => ({ pick: '', named: { name: '', kind: 'person_role' } });

/** Whether a question takes this choice: who does it, or which application. */
export const takesNamed = (item: TriageItem | undefined): item is TriageItem => Boolean(item && (item.kind === 'role' || item.kind === 'system'));

const input = 'mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm';

export function NamedChoice({ item, model, value, onChange, id = 'named' }: { item: TriageItem; model: ProcessModel; value: NamedValue; onChange: (v: NamedValue) => void; id?: string }) {
  const role = item.kind === 'role';
  const options: { id: string; name: string }[] = role ? model.roles : model.systems;
  const other = role ? 'Someone else' : 'Another application';
  const line = namedRecordLine(item, model, value);
  return (
    <div className="space-y-2" data-testid="named-choice">
      <label htmlFor={`${id}-pick`} className="block text-sm font-medium text-slate-700">{role ? 'Who does it' : 'Which application'}</label>
      <select id={`${id}-pick`} aria-label={role ? 'Choose the role' : 'Choose the application'} value={value.pick} onChange={e => onChange({ ...value, pick: e.target.value })} className={input}>
        <option value="">{role ? 'Choose the role' : 'Choose the application'}</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        <option value={SOMEONE_ELSE}>{other}…</option>
      </select>
      {value.pick === SOMEONE_ELSE && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[14rem] flex-1 text-sm font-medium text-slate-700">{role ? 'Their role' : 'The application’s name'}
            <input value={value.named.name} maxLength={120} onChange={e => onChange({ ...value, named: { ...value.named, name: e.target.value } })} className={input}
              placeholder={role ? 'For example: Accounts payable lead' : 'For example: Coupa'} />
          </label>
          {role && (
            <label className="text-sm font-medium text-slate-700">As
              <select aria-label="Kind of role" value={value.named.kind ?? 'person_role'} onChange={e => onChange({ ...value, named: { ...value.named, kind: e.target.value as Named['kind'] } })} className={input}>
                {NAMED_KINDS.map(([v, l]) => <option key={v} value={v}>{l.toLowerCase()}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {line && <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm leading-6 text-sky-950 ring-1 ring-inset ring-sky-200" role="status" data-testid="named-record">{line}</p>}
    </div>
  );
}
