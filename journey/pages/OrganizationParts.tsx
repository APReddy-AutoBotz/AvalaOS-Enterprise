// Settings → "Parts of Avala OS": which of the four set-ups the organisation uses. Everyone sees it;
// only the platform owner changes it. A part that is off is hidden; nothing in it is deleted.
import React from 'react';
import type { JourneyStore, Workspace } from '../store/types.ts';
import { ALL_MODULES, ModulesError, planOf, PLANS, validateModules, type Plan } from '../../domain/workspace/modules.ts';
import { Button, cx, ErrorNote, messageOf } from '../ui.tsx';

/** Other screens (the main navigation) read the parts again when this event fires. */
export const PARTS_CHANGED = 'avala:parts-changed';

export function OrganizationParts({ store, workspace }: { store: JourneyStore; workspace: Workspace }) {
  const [owner, setOwner] = React.useState(false);
  const [modules, setModules] = React.useState(workspace.modules ?? ALL_MODULES);
  const current = planOf(modules) ?? PLANS[0]!;
  const [choice, setChoice] = React.useState<Plan['id']>(current.id);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => { store.canCreateOrganization().then(setOwner).catch(() => setOwner(false)); }, [store]);
  const org = workspace.organizationName || 'This organisation';
  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    try {
      const modules = validateModules(PLANS.find(p => p.id === choice)!.modules);
      const next = await store.setOrganizationModules(workspace.organizationId ?? workspace.id, modules);
      setModules(next);
      window.dispatchEvent(new Event(PARTS_CHANGED));
      setSaved(true);
    } catch (x) { setError(x instanceof ModulesError ? x.message : messageOf(x)); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6" data-testid="organization-parts">
      <h2 className="font-display text-lg font-semibold text-slate-900">Parts of Avala OS</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        {org} uses <span className="font-semibold text-slate-900">{current.label}</span>. {owner ? 'Switching a part off hides it; nothing in it is deleted, and switching it on again brings it all back.' : 'To change this, ask the Avala OS team.'}
      </p>
      {owner && (
        <fieldset className="mt-4">
          <legend className="sr-only">Choose what {org} uses</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {PLANS.map(p => (
              <label key={p.id} className={cx('flex cursor-pointer gap-3 rounded-lg p-3 ring-1 ring-inset', choice === p.id ? 'bg-[#EDF1F5] ring-[#002C4B]' : 'ring-slate-200 hover:bg-slate-50')}>
                <input type="radio" name={`parts-${workspace.id}`} value={p.id} checked={choice === p.id} onChange={() => { setChoice(p.id); setSaved(false); }} className="mt-1 accent-[#002C4B]" />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{p.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-slate-600">{p.what}</span>
                </span>
              </label>
            ))}
          </div>
          <ErrorNote message={error} />
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={save} disabled={busy || choice === current.id}>{busy ? 'Saving…' : 'Save'}</Button>
            {saved && <span role="status" className="text-sm text-emerald-700">Saved. Everyone in {org} sees this the next time a page opens.</span>}
          </div>
        </fieldset>
      )}
    </div>
  );
}
