// The last guard around every page: a screen that fails to draw is reported (journey/monitoring.ts) and
// replaced by a plain message with a way back, instead of a blank page.
import React from 'react';
import { report } from './monitoring.ts';

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { report(error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className="mx-auto max-w-lg p-10 text-center">
        <h1 className="font-display text-xl font-semibold text-slate-900">Something went wrong on this page</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Your saved work is safe. Reload the page to try again; if it keeps happening, write to us and say what you were doing.</p>
        <div className="mt-5 flex justify-center gap-3">
          <button type="button" onClick={() => location.reload()} className="rounded-lg bg-[#002C4B] px-4 py-2 text-sm font-semibold text-white">Reload</button>
          <a href="/work" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Go to My work</a>
        </div>
      </main>
    );
  }
}
