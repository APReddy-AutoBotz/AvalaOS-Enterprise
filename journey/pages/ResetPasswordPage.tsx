// /reset-password: where the emailed reset link lands, already signed in for this one purpose.
// The person chooses a new password and goes on to My work.
import React from 'react';
import type { JourneyStore } from '../store/types.ts';
import type { Nav } from '../JourneyApp.tsx';
import { Button, ErrorNote, Field, messageOf } from '../ui.tsx';

export function ResetPasswordPage({ store, nav }: { store: JourneyStore; nav: Nav }) {
  const [password, setPassword] = React.useState('');
  const [again, setAgain] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) { setError('The two passwords are not the same.'); return; }
    setBusy(true);
    setError(null);
    try {
      await store.setNewPassword(password);
      setDone(true);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Choose a new password</h1>
      {done ? (
        <div className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <p role="status" className="text-sm text-emerald-800">Your password is changed. Use it the next time you sign in with your email address.</p>
          <Button className="w-full" onClick={() => nav.go({ page: 'work' })}>Go to my work</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <Field label="New password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} hint="At least 8 characters." />
          <Field label="New password again" type="password" autoComplete="new-password" required minLength={8} value={again} onChange={e => setAgain(e.target.value)} />
          <ErrorNote message={error} />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Please wait…' : 'Save the new password'}</Button>
        </form>
      )}
    </div>
  );
}
