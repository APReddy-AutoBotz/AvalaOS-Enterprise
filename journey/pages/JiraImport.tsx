// Import from Jira: a person picks Jira's CSV export, sees what will come over (and what will not),
// then adds it to this board in one go. Rules: domain/workitems/jiraImport.ts.
import React from 'react';
import type { JourneyStore, Member } from '../store/types.ts';
import { STATUS_LABEL } from '../../domain/workitems/board.ts';
import { ImportError, planJiraImport, type ImportPlan } from '../../domain/workitems/jiraImport.ts';
import { Button, ErrorNote, messageOf, TypeGlyph, WORK_TYPE } from '../ui.tsx';

const SHOWN = 12;

export function JiraImportDialog({ store, projectId, projectName, members, onDone, onClose }: { store: JourneyStore; projectId: string; projectName: string; members: Member[]; onDone: (count: number) => void; onClose: () => void }) {
  const [plan, setPlan] = React.useState<ImportPlan | null>(null);
  const [fileName, setFileName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  const read = async (file: File | undefined) => {
    setPlan(null); setError(null);
    if (!file) return;
    setFileName(file.name);
    try { setPlan(planJiraImport(await file.text(), members)); } catch (x) { setError(x instanceof ImportError ? x.message : messageOf(x)); }
  };
  const go = async () => {
    if (!plan) return;
    setBusy(true); setError(null);
    try { onDone(await store.importWorkItems(projectId, plan.items)); } catch (x) { setError(messageOf(x)); setBusy(false); }
  };
  const owner = (id: string | null) => (id ? members.find(m => m.userId === id)?.name : null);
  const kinds = plan ? (Object.entries(plan.counts) as [keyof typeof WORK_TYPE, number][]).map(([t, n]) => `${n} ${n === 1 ? WORK_TYPE[t].label.toLowerCase() : WORK_TYPE[t].plural.toLowerCase()}`).join(', ') : '';
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/25 px-4 py-16" onClick={() => { if (!busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Import from Jira" onClick={e => e.stopPropagation()} className="w-full max-w-3xl rounded-xl bg-white p-6 shadow-[0_24px_56px_-20px_rgba(15,23,42,0.45)]" data-testid="jira-import">
        <h2 className="font-display text-lg font-semibold text-slate-900">Import from Jira</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">In Jira, search for the issues to bring over, then choose Export → Export CSV (all fields). Pick that file here. You will see what comes over before anything is added to {projectName}.</p>
        <label className="mt-4 block text-sm font-medium text-slate-800">Jira CSV file
          <input type="file" accept=".csv,text/csv" aria-label="Jira CSV file" onChange={e => read(e.target.files?.[0])} className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-200" />
        </label>
        <ErrorNote message={error} />
        {plan && (
          <div className="mt-5" data-testid="import-preview">
            <p className="text-sm font-semibold text-slate-900">{fileName}: {plan.items.length} {plan.items.length === 1 ? 'item' : 'items'} ({kinds})</p>
            <p className="mt-1 text-sm text-slate-600">Kept: kind, title, description, status, priority, owner (a member with the same name), parent, labels, estimate and dates. They are added after the items already on this board.</p>
            {plan.notes.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 rounded-lg bg-amber-50 py-3 pl-8 pr-4 text-sm leading-6 text-amber-950 ring-1 ring-inset ring-amber-200" data-testid="import-notes">
                {plan.notes.map(n => <li key={n}>{n}</li>)}
              </ul>
            )}
            <div className="mt-3 overflow-x-auto rounded-lg ring-1 ring-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-2 font-medium">Jira</th><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Under</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Owner</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {plan.items.slice(0, SHOWN).map((i, n) => (
                    <tr key={n}>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{i.ref}</td>
                      <td className="px-3 py-2"><span className="flex items-center gap-2"><TypeGlyph type={i.type} /><span className="text-slate-900">{i.title}</span></span></td>
                      <td className="px-3 py-2 text-slate-600">{i.parent === null ? '' : plan.items[i.parent]!.title}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">{STATUS_LABEL[i.status]}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">{owner(i.ownerId) ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {plan.items.length > SHOWN && <p className="mt-2 text-xs text-slate-500">And {plan.items.length - SHOWN} more.</p>}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          {plan && <Button disabled={busy} onClick={go}>{busy ? 'Importing…' : `Import ${plan.items.length} ${plan.items.length === 1 ? 'item' : 'items'}`}</Button>}
        </div>
      </div>
    </div>
  );
}
