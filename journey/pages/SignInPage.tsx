import React from 'react';
import type { JourneyStore } from '../store/types.ts';
import { Button, ErrorNote, Field, messageOf } from '../ui.tsx';

export function SignInPage({ store }: { store: JourneyStore }) {
  const [mode, setMode] = React.useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
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
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required minLength={6} value={password} onChange={e => setPassword(e.target.value)} />
        <ErrorNote message={error} />
        {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
        <button type="button" className="font-semibold text-[#002C4B] underline-offset-2 hover:underline" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setNotice(null); }}>
          {mode === 'signin' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </div>
  );
}
