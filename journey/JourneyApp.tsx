// The process journey: sign in, pick a process, work through its stages.
// Owns the paths /signin, /processes and /process/:id/:stage; everything else is the earlier app.
import React from 'react';
import { journeyPath, parseJourneyPath, type JourneyRoute } from '../domain/workspace/route.ts';
import { createJourneyStore } from './store/index.ts';
import type { JourneyStore, Me } from './store/types.ts';
import { SignInPage } from './pages/SignInPage.tsx';
import { ProcessesPage } from './pages/ProcessesPage.tsx';
import { ProcessWorkspace } from './pages/ProcessWorkspace.tsx';
import { Button, Spinner } from './ui.tsx';

const store = createJourneyStore();

export interface Nav {
  route: JourneyRoute;
  go(route: JourneyRoute, opts?: { replace?: boolean }): void;
}

function useRoute(): Nav {
  const [route, setRoute] = React.useState<JourneyRoute>(() => parseJourneyPath(location.pathname) ?? { page: 'processes' });
  React.useEffect(() => {
    const onPop = () => setRoute(parseJourneyPath(location.pathname) ?? { page: 'processes' });
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  const go = React.useCallback((next: JourneyRoute, opts?: { replace?: boolean }) => {
    const path = journeyPath(next);
    if (path !== location.pathname) history[opts?.replace ? 'replaceState' : 'pushState'](null, '', path);
    setRoute(next);
    scrollTo(0, 0);
  }, []);
  return { route, go };
}

export default function JourneyApp() {
  if (!store) {
    return (
      <main className="mx-auto max-w-lg p-10 text-center">
        <h1 className="font-display text-xl font-semibold text-slate-900">Not connected</h1>
        <p className="mt-2 text-sm text-slate-600">This build has no server configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY and rebuild.</p>
      </main>
    );
  }
  return <Journey store={store} />;
}

function Journey({ store }: { store: JourneyStore }) {
  const nav = useRoute();
  const [me, setMe] = React.useState<Me | null | undefined>(undefined);
  const afterSignIn = React.useRef<JourneyRoute | null>(null);

  React.useEffect(() => {
    let live = true;
    store.currentUser().then(u => { if (live) setMe(u); }).catch(() => { if (live) setMe(null); });
    const off = store.onAuthChange(u => setMe(u));
    return () => { live = false; off(); };
  }, [store]);

  React.useEffect(() => {
    if (me === null && nav.route.page !== 'signin') {
      afterSignIn.current = nav.route;
      nav.go({ page: 'signin' }, { replace: true });
    } else if (me && nav.route.page === 'signin') {
      nav.go(afterSignIn.current ?? { page: 'processes' }, { replace: true });
      afterSignIn.current = null;
    }
  }, [me, nav]);

  if (me === undefined) return <Spinner />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <a href="/processes" onClick={e => { e.preventDefault(); if (me) nav.go({ page: 'processes' }); }} className="flex items-center gap-2.5">
            <img src="/brand/avala-os-app-icon.svg" alt="" className="h-7 w-7" />
            <span className="font-display text-base font-semibold tracking-tight text-[#002C4B]">AvalaOS</span>
          </a>
          {me && (
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <span className="hidden sm:inline">{me.email}</span>
              <Button variant="ghost" onClick={() => store.signOut()}>Sign out</Button>
            </div>
          )}
        </div>
      </header>
      {store.kind === 'memory' && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-1.5 text-center text-xs text-amber-900">
          Local mode: data stays in this browser and is not saved to a server.
        </div>
      )}
      <main className="mx-auto max-w-7xl px-6 py-8">
        {!me || nav.route.page === 'signin' ? <SignInPage store={store} /> :
          nav.route.page === 'processes' ? <ProcessesPage store={store} nav={nav} /> :
            <ProcessWorkspace key={nav.route.processId} store={store} nav={nav} processId={nav.route.processId} stage={nav.route.stage} />}
      </main>
    </div>
  );
}
