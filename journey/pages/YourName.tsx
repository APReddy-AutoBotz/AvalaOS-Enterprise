// Settings → "Your name": the name the people in a person's workspaces see on what they do (plan
// claude/your-name-plan-28-nov.md). One field and Save; the rule is domain/people/name.ts, which the database
// holds too. Everyone sees it, in every workspace, set-up and role.
import React from 'react';
import type { JourneyStore } from '../store/types.ts';
import { checkName, NAME_MAX, NAME_WORDS, nameFromAddress } from '../../domain/people/name.ts';
import { NAME_LINE_CLOSED } from '../../domain/site/storage.ts';
import { Button, CARD, cx, ErrorNote, messageOf } from '../ui.tsx';

/** Other screens (the account menu, My work's line) read the name again when this event fires. */
export const NAME_CHANGED = 'avala:name-changed';

export function YourName({ store }: { store: JourneyStore }) {
  const demo = store.kind === 'demo';
  const [stored, setStored] = React.useState<string | null>(null);
  const [value, setValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    store.getMyName().then(n => { if (live) { setStored(n ?? ''); setValue(n ?? ''); } }).catch(() => { if (live) setStored(''); });
    return () => { live = false; };
  }, [store]);
  const checked = checkName(value);
  const changed = checked.ok ? checked.name !== (stored ?? '').trim() : value !== (stored ?? '');
  const save = async () => {
    if (!checked.ok) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const name = await store.setMyName(checked.name);
      setStored(name); setValue(name); setSaved(true);
      window.dispatchEvent(new Event(NAME_CHANGED));
    } catch (x) { setError(messageOf(x)); } finally { setBusy(false); }
  };
  const showReason = !checked.ok && changed;
  return (
    <div className={cx(CARD, 'p-6')} data-testid="your-name">
      <h2 className="font-display text-lg font-semibold text-slate-900">Your name</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">{NAME_WORDS.why}</p>
      <form className="mt-4 max-w-md" onSubmit={e => { e.preventDefault(); if (!demo && checked.ok && changed) void save(); }}>
        <label htmlFor="your-name-field" className="block text-sm font-medium text-slate-800">Name</label>
        <input id="your-name-field" type="text" autoComplete="name" value={value} disabled={stored === null || busy}
          onChange={e => { setValue(e.target.value); setSaved(false); setError(null); }}
          aria-invalid={showReason || undefined} aria-describedby={showReason ? 'your-name-reason' : undefined}
          className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20 disabled:bg-slate-50" />
        <p className="mt-1 text-xs text-slate-500">Up to {NAME_MAX} characters.</p>
        {showReason && <p id="your-name-reason" className="mt-1 text-sm text-rose-700">{checked.reason}</p>}
        <ErrorNote message={error} />
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" disabled={demo || busy || stored === null || !checked.ok || !changed}>{busy ? 'Saving…' : 'Save'}</Button>
          {saved && <span role="status" className="text-sm text-emerald-700">{NAME_WORDS.saved}</span>}
          {demo && <span className="text-sm text-slate-600">{NAME_WORDS.demo}</span>}
        </div>
      </form>
    </div>
  );
}


/**
 * One quiet line at the top of My work while a person's name is still the one sign-up made from their address
 * ("Your name shows as 'ann'. Set your name"). It goes once a name is saved, or once closed: kept in the browser
 * under a key that holds no id and goes at sign-out (domain/site/storage.ts).
 */
export function SetNameLine({ store, userId, onOpen }: { store: JourneyStore; userId: string; onOpen: () => void }) {
  const [shows, setShows] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (store.kind === 'demo') return;
    let live = true;
    const read = () => {
      try { if (localStorage.getItem(NAME_LINE_CLOSED)) { setShows(null); return; } } catch { /* storage unavailable */ }
      Promise.all([store.currentUser(), store.getMyName()]).then(([me, name]) => {
        if (!live) return;
        setShows(me && name !== null && nameFromAddress(name, me.email) ? (name.trim() || '') : null);
      }).catch(() => { if (live) setShows(null); });
    };
    read();
    window.addEventListener(NAME_CHANGED, read);
    return () => { live = false; window.removeEventListener(NAME_CHANGED, read); };
  }, [store, userId]);
  if (shows === null) return null;
  const close = () => { try { localStorage.setItem(NAME_LINE_CLOSED, '1'); } catch { /* storage unavailable */ } setShows(null); };
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600" data-testid="set-name-line">
      <span>{shows ? <>Your name shows as “{shows}”.</> : <>Your name is not set yet.</>}</span>
      <button type="button" onClick={onOpen} className="font-semibold text-[#002C4B] underline-offset-2 hover:underline">Set your name</button>
      <button type="button" onClick={close} aria-label="Close this line" className="text-slate-400 hover:text-slate-600">×</button>
    </p>
  );
}
