// Settings → AI provider: a workspace uses Avala OS's AI (within a monthly allowance) or its own key: OpenAI,
// Azure OpenAI, Anthropic, Claude on Amazon Bedrock, or an OpenAI-compatible endpoint it runs. Admins set the key once; it is kept encrypted on the server and only its
// last four characters are ever shown. A provider not yet checked by the extraction eval is listed only for
// the platform owner (the person who may create organizations). Rules in domain/ai/providers.ts.
import React from 'react';
import type { JourneyStore, Workspace, WorkspaceAi } from '../store/types.ts';
import { AI_PROVIDERS, AiSettingsError, selectableProviders, validateAiChoice, validateApiKey, type AiNeed, type AiProvider } from '../../domain/ai/providers.ts';
import { Button, ErrorNote, Field, messageOf, Spinner, when } from '../ui.tsx';

const NEEDS: [AiNeed, string][] = [['transcription', 'Turning speech into text']];

export function AiProviderSettings({ store, workspace }: { store: JourneyStore; workspace: Workspace }) {
  const isAdmin = workspace.role === 'admin';
  const [current, setCurrent] = React.useState<WorkspaceAi | null | undefined>(undefined);
  const [editing, setEditing] = React.useState(false);
  const [provider, setProvider] = React.useState<AiProvider>('openai');
  const [model, setModel] = React.useState('');
  const [endpoint, setEndpoint] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [owner, setOwner] = React.useState(false);
  React.useEffect(() => { if (isAdmin) store.canCreateOrganization().then(setOwner).catch(() => setOwner(false)); }, [store, isAdmin]);

  const load = React.useCallback(async () => {
    const ai = await store.getWorkspaceAi(workspace.id);
    setCurrent(ai);
    setProvider(ai?.provider ?? 'openai');
    setModel(ai?.model ?? '');
    setEndpoint(ai?.endpoint ?? '');
    setApiKey('');
  }, [store, workspace.id]);
  React.useEffect(() => { load().catch(e => setError(messageOf(e))); }, [load]);

  if (current === undefined) return error ? <ErrorNote message={error} /> : <Spinner />;
  const info = AI_PROVIDERS[provider];
  const choices = selectableProviders(owner);
  if (current && !choices.includes(current.provider)) choices.push(current.provider);
  const offered = selectableProviders(false).map(p => AI_PROVIDERS[p].label);
  const offeredWords = offered.length > 1 ? `${offered.slice(0, -1).join(', ')} or ${offered[offered.length - 1]}` : offered[0];
  const keepsKey = Boolean(current && current.provider === provider);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); } catch (e) { setError(e instanceof AiSettingsError ? e.message : messageOf(e)); } finally { setBusy(false); }
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    act(async () => {
      const choice = validateAiChoice({ provider, model, endpoint });
      const key = apiKey.trim() ? validateApiKey(apiKey) : undefined;
      if (!key && !keepsKey) throw new AiSettingsError(`Paste the ${AI_PROVIDERS[provider].label} API key.`);
      await store.saveWorkspaceAi(workspace.id, { ...choice, apiKey: key });
      await load();
      setEditing(false);
      setNotice('Saved. Test the key to make sure it works.');
    });
  };
  const test = () => act(async () => {
    const r = await store.testWorkspaceAi(workspace.id);
    await load();
    setNotice(`The ${r.source === 'workspace' ? 'key' : 'platform connection'} works with ${r.model}.`);
  });
  const remove = () => {
    if (!window.confirm(`Stop using this ${current ? AI_PROVIDERS[current.provider].label : ''} key? It is deleted from Avala OS, and AI work in ${workspace.name} goes back to Avala OS's AI and its monthly allowance.`)) return;
    act(async () => { await store.clearWorkspaceAi(workspace.id); await load(); setNotice('The key is deleted. This workspace uses Avala OS\'s AI again.'); });
  };

  const missing = current ? NEEDS.filter(([need]) => !AI_PROVIDERS[current.provider].can[need]).map(([, words]) => words) : [];
  const showForm = isAdmin && (editing || !current);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6" data-testid="ai-provider">
      <h2 className="font-display text-lg font-semibold text-slate-900">AI provider</h2>
      {current ? (
        <div className="mt-2 space-y-1 text-sm leading-6 text-slate-700" data-testid="ai-provider-state">
          <p>AI work in <span className="font-medium">{workspace.name}</span> runs on your own <span className="font-medium">{AI_PROVIDERS[current.provider].label}</span> key ending <span className="font-mono">{current.keyHint}</span>, with {AI_PROVIDERS[current.provider].modelLabel.toLowerCase()} <span className="font-mono">{current.model}</span>{current.endpoint ? <> at <span className="font-mono">{current.endpoint.replace(/^https:\/\//, '')}</span></> : null}. Avala OS's monthly allowance does not apply.</p>
          <p className="text-xs text-slate-500">
            {current.lastUsedAt ? `Last used ${when(current.lastUsedAt)}.` : 'Not used yet.'}{' '}
            {current.lastTestedAt ? (current.lastTestOk ? `Tested ${when(current.lastTestedAt)}: it worked.` : `Tested ${when(current.lastTestedAt)}: it did not work.`) : 'Not tested yet.'}
          </p>
          {missing.length > 0 && <p className="text-xs text-slate-500">Not available with this provider yet: {missing.join(', ').toLowerCase()}. Those features say so instead of using another key.</p>}
        </div>
      ) : (
        <p className="mt-2 text-sm leading-6 text-slate-700" data-testid="ai-provider-state">
          {workspace.name} uses Avala OS's AI, within a monthly allowance. {isAdmin ? `You can connect your organization's own ${offeredWords} key instead: then all AI work here runs on that key, and the allowance no longer applies.` : 'An admin can connect your organization\'s own key instead.'}
        </p>
      )}

      {showForm && (
        <form className="mt-5 space-y-4" onSubmit={save}>
          <label className="block">
            <span className="block text-sm font-semibold text-slate-900">Provider</span>
            <select aria-label="Provider" value={provider} disabled={busy} onChange={e => setProvider(e.target.value as AiProvider)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20">
              {choices.map(p => <option key={p} value={p}>{AI_PROVIDERS[p].label}{AI_PROVIDERS[p].checked ? '' : ' (being checked)'}</option>)}
            </select>
            {!info.checked && <span className="mt-1 block text-xs text-slate-500" data-testid="ai-provider-unchecked">{owner ? 'Only you see this provider: it is offered to workspaces once the extraction check has been run with it.' : 'This provider has not been checked for extraction quality yet.'}</span>}
          </label>
          <Field label={info.modelLabel} value={model} onChange={e => setModel(e.target.value)} hint={info.modelHint} autoComplete="off" spellCheck={false} />
          {info.needsEndpoint && <Field label={info.endpointLabel ?? 'Endpoint'} value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder={info.endpointPlaceholder} hint={info.endpointHint} autoComplete="off" spellCheck={false} />}
          <Field label="API key" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="new-password" spellCheck={false}
            placeholder={keepsKey ? `Leave empty to keep the key ending ${current!.keyHint}` : 'Paste the key'}
            hint="Sent once over an encrypted connection and kept encrypted on the server. Avala OS shows only its last four characters." />
          <ErrorNote message={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            {current && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setError(null); load(); }}>Cancel</Button>}
          </div>
        </form>
      )}

      {!showForm && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {current && <Button variant="secondary" disabled={busy} onClick={test}>{busy ? 'Testing…' : 'Test this key'}</Button>}
          {isAdmin && current && <Button variant="ghost" disabled={busy} onClick={() => { setEditing(true); setNotice(null); setError(null); }}>Change</Button>}
          {isAdmin && current && <Button variant="ghost" disabled={busy} onClick={remove}>Stop using this key</Button>}
        </div>
      )}
      <div className="mt-3" aria-live="polite">
        {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
        {!showForm && <ErrorNote message={error} />}
      </div>
    </div>
  );
}
