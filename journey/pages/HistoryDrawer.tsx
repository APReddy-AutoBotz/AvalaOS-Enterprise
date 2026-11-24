// History: every revision and saved edit, and the internal versions behind them. This is the one
// place where edit counts, content hashes and schema versions are shown.
import React from 'react';
import { PROCESS_MODEL_SCHEMA_VERSION } from '../../domain/processModel/types.ts';
import type { DraftChangeRow, EditRow, JourneyStore, RevisionRow, VersionRow } from '../store/types.ts';
import { CHANGE_RECORD_HEADING, CHANGE_RECORD_SINCE, changeEntry, keptAsRevisionLine } from '../../domain/docs/changeRecord.ts';
import { orderedSteps } from '../../domain/processModel/selectors.ts';
import { Button, ErrorNote, messageOf, Spinner, when } from '../ui.tsx';

const STATE_LABEL = { working: 'Working draft', approved: 'Approved', superseded: 'Superseded' } as const;
const ORIGIN_LABEL: Record<string, string> = { user: 'Edited by a person', extraction: 'Extracted from sources', diagram: 'Edited in a flow diagram', import: 'Imported', system: 'System' };

/** Changes to documents and choices (pull request 5): the change record, with names and the current record's steps. */
interface ChangeView { rows: DraftChangeRow[]; versions: VersionRow[]; names: Record<string, string>; steps: Map<string, string> }

export function HistoryDrawer({ store, processId, workspaceId, onClose }: { store: JourneyStore; processId: string; workspaceId: string; onClose: () => void }) {
  const [data, setData] = React.useState<{ revisions: RevisionRow[]; edits: EditRow[] } | null>(null);
  const [changes, setChanges] = React.useState<ChangeView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    store.history(processId).then(setData).catch(e => setError(messageOf(e)));
    (async () => {
      const [rows, versions, members, revisions] = await Promise.all([store.listDraftChanges(processId), store.listVersions(processId), store.listMembers(workspaceId), store.listRevisions(processId)]);
      // Steps are named from the current record: the working draft, else the approved revision.
      const current = revisions.find(r => r.state === 'working') ?? revisions.find(r => r.state === 'approved');
      const model = current ? await store.getModel(current.id).catch(() => null) : null;
      const steps = new Map((model ? orderedSteps(model) : []).map((st, i) => [st.id, `step ${i + 1}, ${st.name}`]));
      setChanges({ rows, versions, names: Object.fromEntries(members.map(m => [m.userId, m.name])), steps });
    })().catch(e => setError(messageOf(e)));
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [store, processId, workspaceId, onClose]);

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-slate-950/40" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label="History" data-testid="history" className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="font-display text-lg font-semibold text-slate-900">History</h2>
          <Button ref={closeRef} variant="ghost" onClick={onClose}>Close</Button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 text-sm">
          <ErrorNote message={error} />
          {!data && !error && <Spinner />}
          {data && data.revisions.length === 0 && <p className="text-slate-600">No revisions yet.</p>}
          {data && data.revisions.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-slate-500">Revisions</h3>
              <ol className="mt-2 space-y-3">
                {data.revisions.map(r => (
                  <li key={r.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">Revision {r.revNo}</span>
                      <span className="text-xs font-medium text-slate-600">{STATE_LABEL[r.state]}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Started {when(r.createdAt)}{r.approvedAt ? ` · approved ${when(r.approvedAt)}` : ''}</p>
                    {changes?.versions.filter(v => v.revisionId === r.id).map(v => <p key={v.id} className="mt-1 text-xs font-medium text-emerald-800" data-testid="history-kept-as">{keptAsRevisionLine(v.number, Boolean(v.keptAt))}</p>)}
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-slate-600">
                      <dt>Edits saved</dt><dd>{r.seq}</dd>
                      <dt>Content hash</dt><dd className="font-mono">{r.modelHash ? r.modelHash.slice(0, 16) : '—'}</dd>
                      <dt>Record id</dt><dd className="truncate font-mono">{r.id}</dd>
                    </dl>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {data && data.edits.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-slate-500">Edits</h3>
              <ol className="mt-2 space-y-2">
                {data.edits.map(e => (
                  <li key={`${e.revisionId}-${e.seq}`} className="border-l-2 border-slate-200 pl-3">
                    <p className="text-slate-800">{e.summary || ORIGIN_LABEL[e.origin] || e.origin}</p>
                    <p className="text-xs text-slate-500">{when(e.createdAt)} · edit {e.seq} · {e.operations} change{e.operations === 1 ? '' : 's'}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {changes && (
            <section data-testid="history-changes">
              <h3 className="text-xs font-semibold text-slate-500">{CHANGE_RECORD_HEADING}</h3>
              <p className="mt-0.5 text-xs text-slate-500">{CHANGE_RECORD_SINCE}</p>
              <ol className="mt-2 space-y-2">
                {changes.rows.map(row => {
                  const e = changeEntry(row, { names: changes.names, stepLabel: id => changes.steps.get(id) ?? null }, when);
                  return (
                    <li key={row.id} className="border-l-2 border-slate-200 pl-3" data-testid="history-change">
                      <p className="text-slate-800">{e.text}</p>
                      <p className="text-xs text-slate-500">{e.who} · {e.when}</p>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
          <section>
            <h3 className="text-xs font-semibold text-slate-500">Versions</h3>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-slate-600">
              <dt>Process model schema version</dt><dd>{PROCESS_MODEL_SCHEMA_VERSION}</dd>
            </dl>
          </section>
        </div>
      </aside>
    </div>
  );
}
