// Who is named on a process: an analyst, an architect and an approver. Naming someone puts the
// process's work in front of them on My work; it does not change what anyone is allowed to do.
import React from 'react';
import type { JourneyStore, Member, ProcessPeople as Named } from '../store/types.ts';
import { messageOf } from '../ui.tsx';

const SLOTS = [['analystId', 'Analyst'], ['architectId', 'Architect'], ['approverId', 'Approver']] as const;

export function ProcessPeople({ store, workspaceId, processId, named, canEdit, onError }: { store: JourneyStore; workspaceId: string; processId: string; named: Named; canEdit: boolean; onError: (m: string | null) => void }) {
  const [members, setMembers] = React.useState<Member[]>([]);
  const [value, setValue] = React.useState<Named>(named);
  React.useEffect(() => { store.listMembers(workspaceId).then(setMembers).catch(() => {}); }, [store, workspaceId]);
  React.useEffect(() => setValue(named), [named.analystId, named.architectId, named.approverId]);

  const change = async (key: keyof Named, id: string) => {
    const next = { ...value, [key]: id || null };
    const before = value;
    setValue(next); onError(null);
    try { await store.setProcessPeople(processId, next); } catch (e) { setValue(before); onError(messageOf(e)); }
  };
  const nameOf = (id: string | null) => members.find(m => m.userId === id)?.name ?? null;

  return (
    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm" data-testid="process-people">
      {SLOTS.map(([key, label]) => (
        <div key={key} className="flex items-center gap-2">
          <dt className="text-slate-500">{label}</dt>
          <dd>
            {canEdit ? (
              <select aria-label={label} value={value[key] ?? ''} onChange={e => change(key, e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20">
                <option value="">Nobody named</option>
                {members.map(m => <option key={m.userId} value={m.userId}>{m.name}</option>)}
              </select>
            ) : <span className="text-slate-800">{nameOf(value[key]) ?? 'Nobody named'}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
