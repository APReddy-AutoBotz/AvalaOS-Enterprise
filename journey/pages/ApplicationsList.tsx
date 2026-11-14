// Settings → Applications: the workspace's list of applications, how each is reached and what is
// confirmed. People keep it; processes take its facts only when a person accepts them.
import React from 'react';
import type { JourneyStore, Workspace } from '../store/types.ts';
import { ACCESS_METHODS, ACCESS_STATUSES, ApplicationError, applicationSummary, parseAliases, parseOperations, validateApplication, type AppAccess, type Application, type ApplicationInput } from '../../domain/workspace/applications.ts';
import { SYSTEM_KINDS } from '../process/ProcessEditor.tsx';
import { Button, ErrorNote, messageOf, Spinner } from '../ui.tsx';

const field = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';
const blank = (): Draft => ({ name: '', aliases: '', kind: 'other', access: [], uiAllowed: '', remote: '', notes: '' });
type Tri = '' | 'yes' | 'no';
interface AccessDraft { method: AppAccess['method']; name: string; operations: string; access: AppAccess['access'] }
interface Draft { name: string; aliases: string; kind: ApplicationInput['kind']; access: AccessDraft[]; uiAllowed: Tri; remote: Tri; notes: string }
const tri = (v: boolean | null): Tri => (v === null ? '' : v ? 'yes' : 'no');
const fromTri = (v: Tri) => (v === '' ? null : v === 'yes');
const toDraft = (a: Application): Draft => ({
  name: a.name, aliases: a.aliases.join(', '), kind: a.kind, uiAllowed: tri(a.uiAllowed), remote: tri(a.remote), notes: a.notes,
  access: a.access.map(x => ({ method: x.method, name: x.name ?? '', operations: x.operations.join(', '), access: x.access })),
});
const toInput = (d: Draft): ApplicationInput => ({
  name: d.name, aliases: parseAliases(d.aliases), kind: d.kind, uiAllowed: fromTri(d.uiAllowed), remote: fromTri(d.remote), notes: d.notes,
  access: d.access.map(x => ({ method: x.method, name: x.name, operations: parseOperations(x.operations), access: x.access })),
});
const kindLabel = (k: string) => SYSTEM_KINDS.find(x => x.value === k)?.label ?? k;

export function ApplicationsList({ store, workspace }: { store: JourneyStore; workspace: Workspace }) {
  const canEdit = workspace.role !== 'viewer';
  const [apps, setApps] = React.useState<Application[] | null>(null);
  const [editing, setEditing] = React.useState<{ id: string | null; draft: Draft } | null>(null);
  const [asking, setAsking] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { store.listApplications(workspace.id).then(setApps).catch(e => setError(messageOf(e))); }, [store, workspace.id]);

  const save = async () => {
    if (!editing || !apps) return;
    setError(null);
    let input: ApplicationInput;
    try { input = validateApplication(toInput(editing.draft), apps, editing.id ?? undefined); }
    catch (e) { setError(e instanceof ApplicationError ? e.message : messageOf(e)); return; }
    setBusy(true);
    try {
      const saved = await store.saveApplication(workspace.id, input, editing.id ?? undefined);
      setApps([...apps.filter(a => a.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setEditing(null);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true); setError(null);
    try { await store.deleteApplication(id); setApps((apps ?? []).filter(a => a.id !== id)); setAsking(null); }
    catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="apps-heading" className="rounded-xl border border-slate-200 bg-white p-6" data-testid="applications-list">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="apps-heading" className="font-display text-lg font-semibold text-slate-900">Applications</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">The applications <span className="font-medium">{workspace.name}</span> works in, how each can be reached, and what is confirmed. Enter what you know once; a process that names one of them offers these facts, and a person accepts them. Nothing here is guessed or filled in from sources.</p>
        </div>
        {canEdit && !editing && apps && <Button variant="secondary" onClick={() => { setError(null); setEditing({ id: null, draft: blank() }); }}>Add an application</Button>}
      </div>
      <div className="mt-4"><ErrorNote message={error} /></div>
      {!apps ? (!error && <Spinner />) : (
        <>
          {editing && <ApplicationForm draft={editing.draft} isNew={!editing.id} busy={busy} onChange={draft => setEditing({ ...editing, draft })} onSave={save} onCancel={() => { setEditing(null); setError(null); }} />}
          {apps.length === 0 && !editing && <p className="mt-2 text-sm text-slate-500">No applications yet.{canEdit ? ' Add the ones your processes use, starting with those whose access is already confirmed.' : ''}</p>}
          {apps.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
              {apps.map(a => (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3" data-testid="application-row">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{a.name} <span className="font-normal text-slate-500">· {kindLabel(a.kind)}</span></p>
                    {a.aliases.length > 0 && <p className="text-xs text-slate-500">Also called {a.aliases.join(', ')}</p>}
                    <p className="mt-0.5 text-sm text-slate-700">{applicationSummary(a)}</p>
                    {a.notes && <p className="mt-0.5 whitespace-pre-line text-xs text-slate-500">{a.notes}</p>}
                  </div>
                  {canEdit && (
                    asking === a.id ? (
                      <span className="flex items-center gap-2 text-sm">
                        <span className="text-slate-600">Processes keep what they took from it.</span>
                        <Button variant="secondary" disabled={busy} onClick={() => remove(a.id)} className="border-red-300 text-red-700 hover:bg-red-50">Delete {a.name}</Button>
                        <Button variant="ghost" onClick={() => setAsking(null)}>Keep</Button>
                      </span>
                    ) : (
                      <span className="flex gap-1">
                        <Button variant="ghost" disabled={!!editing} onClick={() => { setError(null); setEditing({ id: a.id, draft: toDraft(a) }); }} aria-label={`Edit ${a.name}`}>Edit</Button>
                        <Button variant="ghost" disabled={!!editing} onClick={() => setAsking(a.id)} aria-label={`Delete ${a.name}`}>Delete</Button>
                      </span>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
          {!canEdit && <p className="mt-3 text-xs text-slate-500">Only editors and admins change this list.</p>}
        </>
      )}
    </section>
  );
}

function ApplicationForm({ draft, isNew, busy, onChange, onSave, onCancel }: { draft: Draft; isNew: boolean; busy: boolean; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void }) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v });
  const setAccess = (i: number, patch: Partial<AccessDraft>) => set('access', draft.access.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <form aria-label={isNew ? 'New application' : `Edit ${draft.name}`} className="mt-3 space-y-4 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200" onSubmit={e => { e.preventDefault(); onSave(); }}>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <label className="text-sm font-medium text-slate-800">Name<input className={`${field} mt-1`} value={draft.name} onChange={e => set('name', e.target.value)} placeholder="SAP S/4HANA" /></label>
        <label className="text-sm font-medium text-slate-800">Kind
          <select className={`${field} mt-1`} value={draft.kind} onChange={e => set('kind', e.target.value as Draft['kind'])}>{SYSTEM_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
        </label>
      </div>
      <label className="block text-sm font-medium text-slate-800">Other names it goes by
        <input className={`${field} mt-1`} value={draft.aliases} onChange={e => set('aliases', e.target.value)} placeholder="SAP, S4" />
        <span className="mt-1 block text-xs font-normal text-slate-500">Separate with commas. A process whose application has one of these names is matched to this one.</span>
      </label>
      <fieldset>
        <legend className="text-sm font-medium text-slate-800">Ways in</legend>
        <p className="text-xs text-slate-500">Each way the application can be reached, and whether it is available for automation.</p>
        <div className="mt-2 space-y-2">
          {draft.access.map((a, i) => (
            <div key={i} className="grid gap-2 rounded-lg bg-white p-2 ring-1 ring-inset ring-slate-200 sm:grid-cols-[7rem_1fr_1fr_11rem_auto]" data-testid="access-row">
              <select aria-label={`Way in ${i + 1}: how`} className={field} value={a.method} onChange={e => setAccess(i, { method: e.target.value as AccessDraft['method'] })}>{ACCESS_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
              <input aria-label={`Way in ${i + 1}: interface name`} className={field} value={a.name} onChange={e => setAccess(i, { name: e.target.value })} placeholder="Interface name (optional)" />
              <input aria-label={`Way in ${i + 1}: operations`} className={field} value={a.operations} onChange={e => setAccess(i, { operations: e.target.value })} placeholder="Operations, comma separated" />
              <select aria-label={`Way in ${i + 1}: available`} className={field} value={a.access} onChange={e => setAccess(i, { access: e.target.value as AccessDraft['access'] })}>{ACCESS_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
              <button type="button" aria-label={`Remove way in ${i + 1}`} className="rounded px-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-red-700" onClick={() => set('access', draft.access.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
        </div>
        <button type="button" className="mt-2 text-sm font-semibold text-[#002C4B] hover:underline" onClick={() => set('access', [...draft.access, { method: 'api', name: '', operations: '', access: 'confirmed' }])}>Add a way in</button>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-800">Robots may use its screens
          <select className={`${field} mt-1`} value={draft.uiAllowed} onChange={e => set('uiAllowed', e.target.value as Tri)}><option value="">Not known</option><option value="yes">Yes</option><option value="no">No, not allowed</option></select>
        </label>
        <label className="text-sm font-medium text-slate-800">Reached through a remote desktop
          <select className={`${field} mt-1`} value={draft.remote} onChange={e => set('remote', e.target.value as Tri)}><option value="">Not known</option><option value="yes">Yes (Citrix or similar)</option><option value="no">No</option></select>
        </label>
      </div>
      <label className="block text-sm font-medium text-slate-800">Notes<textarea rows={2} className={`${field} mt-1`} value={draft.notes} onChange={e => set('notes', e.target.value)} placeholder="Who confirmed it, conditions, what to ask for" /></label>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Add application' : 'Save changes'}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
