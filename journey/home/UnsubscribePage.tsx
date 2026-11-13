// /unsubscribe?token=…: stops the weekday "Needs you" email for the person whose link it is. It loads on
// its own like the trust pages (no application, no sign-in) and asks for one click, so a mail scanner that
// opens the link does not unsubscribe anyone. Mail apps use the one-click header instead (journey-notify).
import React from 'react';
import { SiteFooter, focus, useGo } from './site.tsx';

type State = 'ready' | 'busy' | 'done' | 'error';

export default function UnsubscribePage() {
  const go = useGo();
  const token = React.useMemo(() => new URLSearchParams(window.location.search).get('token') ?? '', []);
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
  const [state, setState] = React.useState<State>('ready');
  React.useEffect(() => { document.title = 'Stop these emails | Avala OS'; }, []);

  const stop = async () => {
    setState('busy');
    try {
      const env = import.meta.env;
      const url = env.VITE_SUPABASE_URL;
      const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
      if (!url || !key) throw new Error('not configured');
      const res = await fetch(`${url}/functions/v1/journey-notify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key }, body: JSON.stringify({ action: 'unsubscribe', token }),
      });
      setState(res.ok ? 'done' : 'error');
    } catch { setState('error'); }
  };

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <div className="bg-[#001B2F]">
        <header className="mx-auto flex h-20 max-w-7xl items-center px-6">
          <a href="/" className={`rounded ${focus} focus-visible:outline-white`}><img src="/brand/avala-os-logo-light.svg" alt="Avala OS, home" className="h-10 w-auto" /></a>
        </header>
      </div>
      <main className="flex-1">
        <div className="mx-auto max-w-xl px-6 py-16" data-testid="unsubscribe">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Stop these emails</h1>
          {!valid ? (
            <p className="mt-4 text-base leading-7 text-slate-700" role="alert">This link is not complete. Copy the whole link from the email, or turn the email off in My work after you sign in.</p>
          ) : state === 'done' ? (
            <p className="mt-4 text-base leading-7 text-slate-700" role="status">Done. You will no longer get the weekday email about work that needs you. You can turn it back on in My work.</p>
          ) : (
            <>
              <p className="mt-4 text-base leading-7 text-slate-700">Avala OS emails you on weekdays when something new needs you on a process you are named on. Stop these emails?</p>
              <button type="button" onClick={stop} disabled={state === 'busy'}
                className={`mt-6 rounded-lg bg-[#002C4B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#003a63] disabled:opacity-60 ${focus} focus-visible:outline-[#002C4B]`}>
                {state === 'busy' ? 'Stopping…' : 'Stop these emails'}
              </button>
              {state === 'error' && <p className="mt-4 text-sm text-red-700" role="alert">That did not work. Try again in a minute, or turn the email off in My work after you sign in.</p>}
            </>
          )}
        </div>
      </main>
      <SiteFooter go={go} />
    </div>
  );
}
