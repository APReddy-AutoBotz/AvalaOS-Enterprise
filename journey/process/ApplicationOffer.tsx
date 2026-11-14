// A process's application and the workspace's applications list: when the list knows the
// application, its facts are offered and a person accepts them (with what that changes downstream);
// when it does not, a person can add it to the list from what this process states or confirmed.
import React from 'react';
import type { SystemRef } from '../../domain/processModel/types.ts';
import { adoptApplication } from '../../domain/processModel/patch.ts';
import { applicationFromSystem, applicationOffer, applicationSummary, matchApplication, type Application, type ApplicationInput } from '../../domain/workspace/applications.ts';
import { Button, messageOf } from '../ui.tsx';
import type { ModelEditor, ModelOp } from './useModelEditor.ts';
import { SidePanel } from './widgets.tsx';

export interface AppList {
  apps: Application[];
  /** Adds an entry to the list; resolves when saved. */
  add(input: ApplicationInput): Promise<void>;
}

export function ApplicationLink({ system, list, editor, canEdit, impactOf }: { system: SystemRef; list: AppList | null; editor: ModelEditor; canEdit: boolean; impactOf: (op: ModelOp) => string | null }) {
  const [open, setOpen] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (!list) return null;
  const app = matchApplication(system, list.apps);
  const cls = 'mt-0.5 block text-xs';

  if (!app) {
    if (!canEdit) return null;
    const entry = applicationFromSystem(system);
    if (!adding) return <button type="button" className={`${cls} font-medium text-[#002C4B] hover:underline`} onClick={() => { setError(null); setAdding(true); }}>Add to the applications list</button>;
    return (
      <span className={`${cls} space-y-1 rounded-lg bg-slate-50 p-2 ring-1 ring-inset ring-slate-200`} data-testid="add-to-list">
        <span className="block text-slate-700">Adds {entry.name} to the workspace's list with: {applicationSummary({ id: '', ...entry })}. Only what a source states or a person confirmed is taken.</span>
        {error && <span role="alert" className="block text-red-700">{error}</span>}
        <span className="flex gap-2">
          <Button disabled={busy} className="px-2 py-1 text-xs" onClick={async () => { setBusy(true); setError(null); try { await list.add(entry); setAdding(false); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); } }}>Add</Button>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setAdding(false)}>Cancel</Button>
        </span>
      </span>
    );
  }

  const lines = applicationOffer(system, app);
  if (!lines.length) return <span className={`${cls} text-emerald-700`} data-testid="on-list">On the applications list{app.name !== system.name ? ` as ${app.name}` : ''}</span>;
  const op: ModelOp = m => adoptApplication(m, { systemId: system.id, app });
  return (
    <>
      <button type="button" data-testid="list-offer" className={`${cls} font-semibold text-amber-800 hover:underline`} onClick={() => setOpen(true)}>
        On the applications list: {lines.length} {lines.length === 1 ? 'fact' : 'facts'} to bring in
      </button>
      {open && (
        <SidePanel title={`From the applications list: ${app.name}`} onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <p className="text-sm leading-6 text-slate-600">The workspace's list says this about {app.name}. Accepting it changes {system.name} in this process as below, each marked as confirmed by a person. The sources already recorded stay.</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            {app.notes && <p className="whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{app.notes}</p>}
            {(() => { const s = impactOf(op); return s ? <p className="text-sm text-slate-700" data-testid="offer-impact"><span className="font-semibold text-slate-900">What this changes downstream.</span> {s}</p> : null; })()}
            {canEdit ? (
              <div className="flex gap-2">
                <Button onClick={async () => { const ok = await editor.apply(op, `Took the applications list's facts for ${system.name}`); if (ok) setOpen(false); }} disabled={editor.saving}>Accept {lines.length === 1 ? 'it' : `all ${lines.length}`}</Button>
                <Button variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
              </div>
            ) : <p className="text-xs text-slate-500">Only editors and admins change the process.</p>}
          </div>
        </SidePanel>
      )}
    </>
  );
}
