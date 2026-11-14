// The right-hand side of the top bar: which workspace the person is in (and, for the organisation's
// owner, adding one), and the account menu with the person's own email choice and Sign out.
import React from 'react';
import type { JourneyStore, Me, Workspace } from './store/types.ts';
import { Button, cx, ErrorNote, Field, Menu, messageOf } from './ui.tsx';

/** The workspaces a person belongs to and the one they are in, owned by the shell (JourneyApp.tsx). */
export interface Workspaces {
  list: Workspace[];
  current: Workspace;
  /** The person picks a workspace: pages that belong to the one left behind are closed. */
  choose(id: string): void;
  /** A page opened by a link belongs to another workspace: the top bar follows it. */
  show(id: string): void;
  reload(): Promise<void>;
}

const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#002C4B]';
const Chevron = () => <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 text-slate-500" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Check = () => <svg viewBox="0 0 12 12" className="h-3.5 w-3.5 shrink-0 text-[#002C4B]" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

export function WorkspaceSwitcher({ store, ws }: { store: JourneyStore; ws: Workspaces }) {
  const [adding, setAdding] = React.useState(false);
  const stopAdding = React.useCallback(() => setAdding(false), []);
  const cur = ws.current;
  const name = (
    <span className="min-w-0 text-left leading-tight">
      <span className="block max-w-[11rem] truncate text-sm font-semibold text-slate-900">{cur.name}</span>
      <span className="hidden max-w-[11rem] truncate text-[11px] text-slate-500 sm:block">{cur.organizationName}</span>
    </span>
  );
  // One workspace and no right to add another: there is nothing to switch, so it is only named.
  if (ws.list.length === 1 && !cur.canAddWorkspace) return <span className="hidden px-2 md:block" data-testid="workspace-name">{name}</span>;
  return (
    <Menu label={`Workspace: ${cur.organizationName} · ${cur.name}`} testId="workspace-menu" onClose={stopAdding}
      buttonClassName="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 hover:bg-slate-50" button={<>{name}<Chevron /></>}>
      {close => (adding ? (
        <NewWorkspace store={store} workspace={cur} onCancel={stopAdding} onCreated={async id => { await ws.reload(); ws.choose(id); close(); }} />
      ) : (
        <>
          <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-slate-500">Workspaces</p>
          <ul className="max-h-72 overflow-y-auto">
            {ws.list.map(w => (
              <li key={w.id}>
                <button type="button" aria-current={w.id === cur.id ? 'true' : undefined} className={cx(item, w.id === cur.id && 'bg-slate-50')} onClick={() => { if (w.id !== cur.id) ws.choose(w.id); close(); }}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{w.name}</span>
                    <span className="block truncate text-xs text-slate-500">{w.organizationName}</span>
                  </span>
                  {w.id === cur.id && <Check />}
                </button>
              </li>
            ))}
          </ul>
          {cur.canAddWorkspace && (
            <div className="mt-1 border-t border-slate-100 pt-1">
              <button type="button" className={cx(item, 'font-semibold text-[#002C4B]')} onClick={() => setAdding(true)}>New workspace</button>
            </div>
          )}
        </>
      ))}
    </Menu>
  );
}

/**
 * Another workspace in the same organisation, for example one per client: people see only the workspaces
 * they are invited to, so a client added to its own workspace sees only its own processes and boards.
 */
function NewWorkspace({ store, workspace, onCreated, onCancel }: { store: JourneyStore; workspace: Workspace; onCreated: (id: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await onCreated(await store.createWorkspace(workspace.organizationId ?? workspace.id, name.trim())); }
    catch (x) { setError(messageOf(x)); setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="p-2.5" data-testid="new-workspace">
      <Field label="New workspace" placeholder="e.g. a client, or Finance Operations" required maxLength={120} value={name} onChange={e => setName(e.target.value)} autoFocus />
      <p className="mt-2 text-xs leading-5 text-slate-500">People see only the workspaces they are invited to. Give each client a workspace of its own and invite its people there: they see only its processes and boards. You become its admin.</p>
      <ErrorNote message={error} />
      <div className="mt-3 flex gap-2"><Button type="submit" disabled={busy || !name.trim()}>Create workspace</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}

export function AccountMenu({ store, me }: { store: JourneyStore; me: Me }) {
  const initial = (me.email.trim()[0] ?? '?').toUpperCase();
  return (
    <Menu label="Account" testId="account-menu" buttonClassName="rounded-full"
      button={<span className="grid h-8 w-8 place-items-center rounded-full bg-[#002C4B] text-xs font-semibold text-white">{initial}</span>}>
      {() => (
        <>
          <p className="px-2.5 pb-0.5 pt-1.5 text-xs text-slate-500">Signed in as</p>
          <p className="truncate px-2.5 pb-2 text-sm font-medium text-slate-900">{me.email}</p>
          <NeedsEmail store={store} />
          <div className="mt-1 border-t border-slate-100 pt-1">
            <button type="button" className={item} onClick={() => store.signOut()}>Sign out</button>
          </div>
        </>
      )}
    </Menu>
  );
}

/** The person's own choice: the weekday email when something new needs them (domain/work/digest.ts). */
function NeedsEmail({ store }: { store: JourneyStore }) {
  const [on, setOn] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { store.getNeedsEmail().then(setOn).catch(() => setOn(null)); }, [store]);
  if (on === null) return null;
  const change = async (next: boolean) => {
    setBusy(true); setError(null);
    try { await store.setNeedsEmail(next); setOn(next); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };
  return (
    <div className="border-t border-slate-100 px-2.5 py-2.5" data-testid="needs-email">
      <label className="flex items-start gap-2 text-sm leading-5 text-slate-700">
        <input type="checkbox" className="mt-1" checked={on} disabled={busy} onChange={e => change(e.target.checked)} />
        <span>Email me on weekdays when something new needs me on a process I am named on.</span>
      </label>
      <ErrorNote message={error} />
    </div>
  );
}
