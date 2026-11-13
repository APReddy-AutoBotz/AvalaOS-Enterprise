// The demo at /demo: the product itself on the sample case (eval/corpus/ap-invoice, a made-up company), in
// the browser only. It starts from the state the tour test leaves the sample in (public/demo-data/sample.json,
// refreshed from that test), keeps every change in memory, and never talks to the database or the AI.
import React from 'react';
import { Journey } from '../JourneyApp.tsx';
import { createMemoryStore } from '../store/memoryStore.ts';
import type { JourneyStore } from '../store/types.ts';
import { DEMO_BASE } from '../../domain/site/pages.ts';
import { Spinner } from '../ui.tsx';

export const DEMO_DATA = '/demo-data/sample.json';

export default function DemoApp() {
  const [store, setStore] = React.useState<JourneyStore | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    document.title = 'Demo | Avala OS';
    let live = true;
    fetch(DEMO_DATA)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(sample => { if (live) setStore(createMemoryStore({ demo: sample })); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  if (failed) {
    return (
      <main className="mx-auto max-w-lg p-10 text-center">
        <h1 className="font-display text-xl font-semibold text-slate-900">The demo did not load</h1>
        <p className="mt-2 text-sm text-slate-600">Reload the page to try again, or <a href="/" className="font-semibold text-[#002C4B] underline">go back to the homepage</a>.</p>
      </main>
    );
  }
  if (!store) return <Spinner />;
  return <Journey store={store} base={DEMO_BASE} />;
}
