// The assessment settings of a workspace: set once by an admin, used by every assessment in it.
import React from 'react';
import type { JourneyStore, Workspace } from '../store/types.ts';
import { DEFAULT_SETTINGS, SETTING_LIMITS, SettingsError, validateSettings, type AssessmentSettings, type SettingsRecord } from '../../domain/assess/settings.ts';
import { Button, ErrorNote, messageOf, Spinner, when } from '../ui.tsx';
import { DocumentBranding } from './DocumentBranding.tsx';

const KEYS = Object.keys(SETTING_LIMITS) as (keyof AssessmentSettings)[];

export function WorkspaceSettings({ store, workspace }: { store: JourneyStore; workspace: Workspace }) {
  const [record, setRecord] = React.useState<SettingsRecord | null>(null);
  const [draft, setDraft] = React.useState<Record<keyof AssessmentSettings, string> | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const isAdmin = workspace.role === 'admin';
  const toDraft = (s: AssessmentSettings) => Object.fromEntries(KEYS.map(k => [k, String(s[k])])) as Record<keyof AssessmentSettings, string>;

  React.useEffect(() => {
    store.getSettings(workspace.id).then(r => { setRecord(r); setDraft(toDraft(r.settings)); }).catch(e => setError(messageOf(e)));
  }, [store, workspace.id]);

  if (!record || !draft) return error ? <ErrorNote message={error} /> : <Spinner />;
  const save = async (values: Record<keyof AssessmentSettings, string>) => {
    setError(null); setSaved(false);
    let next: AssessmentSettings;
    try { next = validateSettings(Object.fromEntries(KEYS.map(k => [k, Number(values[k].replace(/,/g, ''))])) as unknown as AssessmentSettings); }
    catch (e) { setError(e instanceof SettingsError ? e.message : messageOf(e)); return; }
    setBusy(true);
    try {
      await store.saveSettings(workspace.id, next);
      const r = await store.getSettings(workspace.id);
      setRecord(r); setDraft(toDraft(r.settings)); setSaved(true);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };

  return (
    <section className="max-w-3xl space-y-4" data-testid="workspace-settings">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-display text-lg font-semibold text-slate-900">Assessment settings</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">The lines every assessment in <span className="font-medium">{workspace.name}</span> is measured against. They change the value in people, the priority and the portfolio, never the recommended approach.</p>
        <p className="mt-2 text-xs text-slate-500" data-testid="settings-state">{record.custom ? `Set for this workspace${record.updatedAt ? `, last changed ${when(record.updatedAt)}` : ''}.` : 'The defaults apply until an admin sets these.'}{isAdmin ? '' : ' Only an admin can change them.'}</p>
        <form className="mt-5 space-y-4" onSubmit={e => { e.preventDefault(); save(draft); }}>
          {KEYS.map(k => {
            const lim = SETTING_LIMITS[k];
            return (
              <label key={k} className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center sm:gap-6">
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{lim.label}</span>
                  <span className="block text-xs leading-5 text-slate-500">{lim.hint} Default {DEFAULT_SETTINGS[k].toLocaleString('en')}.</span>
                </span>
                <span className="flex items-center gap-2">
                  <input aria-label={lim.label} inputMode="decimal" value={draft[k]} disabled={!isAdmin || busy} onChange={e => setDraft({ ...draft, [k]: e.target.value })}
                    className="w-28 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20 disabled:bg-slate-50 disabled:text-slate-600" />
                  <span className="text-xs text-slate-500">{lim.unit}</span>
                </span>
              </label>
            );
          })}
          <ErrorNote message={error} />
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <Button type="submit" disabled={busy}>Save settings</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => save(toDraft(DEFAULT_SETTINGS))}>Use the defaults</Button>
              {saved && <span className="text-sm text-emerald-700" role="status">Saved. Assessments use these now.</span>}
            </div>
          )}
        </form>
      </div>
      <DocumentBranding store={store} workspace={workspace} />
    </section>
  );
}
