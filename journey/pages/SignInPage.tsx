import React from 'react';
import type { JourneyStore } from '../store/types.ts';
import { Button, ErrorNote, Field, messageOf } from '../ui.tsx';
import { providerLabel, type ProviderId } from '../../domain/auth/providers.ts';

export function SignInPage({ store, initialError = null }: { store: JourneyStore; initialError?: string | null }) {
  const [mode, setMode] = React.useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(initialError);
  const [providers, setProviders] = React.useState<ProviderId[]>([]);
  const [leaving, setLeaving] = React.useState<ProviderId | null>(null);

  React.useEffect(() => {
    let live = true;
    store.signInProviders().then(p => { if (live) setProviders(p); }).catch(() => { /* email and password still work */ });
    return () => { live = false; };
  }, [store]);

  const withProvider = async (p: ProviderId) => {
    setError(null);
    setNotice(null);
    setLeaving(p);
    try {
      await store.signInWithProvider(p);
    } catch (err) {
      setError(messageOf(err));
      setLeaving(null);
    }
  };
  const [notice, setNotice] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signin') await store.signIn(email.trim(), password);
      else {
        const r = await store.signUp(email.trim(), password);
        if (r.needsConfirmation) setNotice('Check your email to confirm the address, then sign in.');
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">{mode === 'signin' ? 'Sign in' : 'Create an account'}</h1>
      <p className="mt-1 text-sm text-slate-600">Assess a process from its sources through to delivery.</p>
      <div className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        {providers.length > 0 && (
          <>
            <div className="space-y-2" role="group" aria-label="Sign in with Google or Microsoft">
              {providers.map(p => (
                <button key={p} type="button" onClick={() => withProvider(p)} disabled={busy || leaving !== null}
                  className="flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002C4B]">
                  {leaving === p ? `Opening ${providerLabel(p)}…` : `Continue with ${providerLabel(p)}`}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500" aria-hidden="true">
              <span className="h-px flex-1 bg-slate-200" />or with email<span className="h-px flex-1 bg-slate-200" />
            </div>
          </>
        )}
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
          <Field label="Password" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required minLength={6} value={password} onChange={e => setPassword(e.target.value)} />
          <ErrorNote message={error} />
          {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
        </form>
      </div>
      <p className="mt-4 text-center text-sm text-slate-600">
        {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
        <button type="button" className="font-semibold text-[#002C4B] underline-offset-2 hover:underline" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setNotice(null); }}>
          {mode === 'signin' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </div>
  );
}
