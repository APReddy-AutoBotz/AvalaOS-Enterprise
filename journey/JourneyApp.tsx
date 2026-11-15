// The process journey: sign in, pick a process, work through its stages.
// Owns the paths /signin, /processes and /process/:id/:stage; everything else is the earlier app.
import React from 'react';
import { journeyPath, parseJourneyPath, type JourneyRoute } from '../domain/workspace/route.ts';
import { createJourneyStore } from './store/index.ts';
import { redirectError, withoutRedirectError } from '../domain/auth/providers.ts';
import type { JourneyStore, Me, Workspace } from './store/types.ts';
import { SignInPage } from './pages/SignInPage.tsx';
import { BoardPage } from './pages/BoardPage.tsx';
import { FirstRun, ProcessesPage } from './pages/ProcessesPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { AccountMenu, WorkspaceSwitcher, type Workspaces } from './TopBar.tsx';
import { AskAvala } from './AskAvala.tsx';
import { remember, remembered } from './workspaceChoice.ts';
import { MyWorkPage } from './pages/MyWorkPage.tsx';
import { ProcessWorkspace } from './pages/ProcessWorkspace.tsx';
import { ResetPasswordPage } from './pages/ResetPasswordPage.tsx';
import { ErrorNote, messageOf, Spinner } from './ui.tsx';
import { navFor } from '../domain/workspace/modules.ts';
import { PARTS_CHANGED } from './pages/OrganizationParts.tsx';

// A provider (Google, Microsoft) that could not sign the person in sends them back with the reason in
// the address. Read it before the store's client starts, then take it out of the address.
const signInRedirectError = redirectError(location.search, location.hash);
if (signInRedirectError) history.replaceState(null, '', withoutRedirectError(location.pathname, location.search, location.hash));

// Created on first use, so the demo (which brings its own store) never starts a database client.
let appStore: JourneyStore | null | undefined;
const getStore = () => (appStore === undefined ? (appStore = createJourneyStore()) : appStore);

export interface Nav {
  route: JourneyRoute;
  go(route: JourneyRoute, opts?: { replace?: boolean }): void;
}

/** The route from the address; `base` is a prefix the journey runs under (the demo's /demo). */
function useRoute(base: string): Nav {
  const current = React.useCallback(() => parseJourneyPath(location.pathname.slice(base.length) || '/work') ?? { page: 'work' } as JourneyRoute, [base]);
  const [route, setRoute] = React.useState<JourneyRoute>(current);
  React.useEffect(() => {
    const onPop = () => setRoute(current());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, [current]);
  const go = React.useCallback((next: JourneyRoute, opts?: { replace?: boolean }) => {
    const path = base + journeyPath(next);
    if (path !== location.pathname) history[opts?.replace ? 'replaceState' : 'pushState'](null, '', path);
    setRoute(next);
    scrollTo(0, 0);
  }, [base]);
  return { route, go };
}

export default function JourneyApp() {
  const store = getStore();
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

// The items of the top bar: a mark and a word each. The page a person is on is navy and carries an amber
// bar; from the widest layout up, where the bar never wraps, the amber bar sits on the bar's bottom edge.
const navItem = (here: boolean) => `group relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#002C4B] ${here
  ? 'font-semibold text-[#002C4B] after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-full after:bg-[#E69F00] xl:after:-bottom-2 xl:after:rounded-b-none'
  : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`;
const NAV_ICON = {
  work: <><path d="M3.5 9.3 10 3.8l6.5 5.5V16a1 1 0 0 1-1 1h-3.3v-4.4H7.8V17H4.5a1 1 0 0 1-1-1z" /></>,
  processes: <><rect x="3" y="3" width="5.5" height="5.5" rx="1.3" /><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.3" /><path d="M8.5 5.75h3.75a2 2 0 0 1 2 2v3.75" /></>,
  board: <><rect x="3" y="3.5" width="3.8" height="13" rx="1.1" /><rect x="8.1" y="3.5" width="3.8" height="8" rx="1.1" /><rect x="13.2" y="3.5" width="3.8" height="10.5" rx="1.1" /></>,
} as const;

export function Journey({ store, base = '' }: { store: JourneyStore; base?: string }) {
  const nav = useRoute(base);
  const demo = store.kind === 'demo';
  const [me, setMe] = React.useState<Me | null | undefined>(undefined);
  const afterSignIn = React.useRef<JourneyRoute | null>(null);
  // The workspaces the person belongs to and the one they are in. Every page works in that one; the top
  // bar shows it and switches it. Read again when the platform owner changes what an organisation uses.
  const [list, setList] = React.useState<Workspace[] | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [currentId, setCurrentId] = React.useState<string | null>(remembered);
  const meId = me?.id ?? null;
  const reload = React.useCallback(async () => { setList(await store.listWorkspaces()); }, [store]);
  React.useEffect(() => {
    if (!meId) { setList(null); return; }
    const read = () => { reload().then(() => setListError(null)).catch(e => setListError(messageOf(e))); };
    read();
    window.addEventListener(PARTS_CHANGED, read);
    return () => window.removeEventListener(PARTS_CHANGED, read);
  }, [meId, reload]);
  const current = list ? list.find(w => w.id === currentId) ?? list[0] ?? null : null;
  const show = React.useCallback((id: string) => { remember(id); setCurrentId(id); }, []);
  const route = nav.route, go = nav.go;
  const choose = React.useCallback((id: string) => {
    show(id);
    // A process or a board project belongs to the workspace left behind.
    if (route.page === 'process') go({ page: 'processes' });
    else if (route.page === 'board' && route.projectId) go({ page: 'board' });
  }, [show, route, go]);
  const ws = React.useMemo<Workspaces | null>(() => (list && current ? { list, current, choose, show, reload } : null), [list, current, choose, show, reload]);
  // The main navigation shows the parts this workspace's organisation uses (domain/workspace/modules.ts).
  const parts = navFor(current);

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
      nav.go(afterSignIn.current ?? { page: 'work' }, { replace: true });
      afterSignIn.current = null;
    }
  }, [me, nav]);

  if (me === undefined) return <Spinner />;

  const signedIn = Boolean(me) && nav.route.page !== 'signin';
  // The board uses the width of the screen: six columns need the room.
  const wide = Boolean(me) && nav.route.page === 'board';
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        {/* On a phone: the mark and the controls on the first row, the main menu in one row under them. */}
        <div className={`mx-auto flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 sm:px-6 ${wide ? 'max-w-[120rem]' : 'max-w-7xl'}`}>
          <a href={`${base}/work`} onClick={e => { e.preventDefault(); if (me) nav.go({ page: 'work' }); }} className="flex shrink-0 items-center gap-2.5">
            <img src="/brand/avala-os-logo.svg" alt="Avala OS" className="hidden h-8 w-auto sm:block" />
            <img src="/brand/avala-os-mark.svg" alt="Avala OS" className="h-8 w-auto sm:hidden" />
          </a>
          {signedIn && (
            <nav aria-label="Main" className="order-last -mx-1 flex w-full gap-1 self-stretch overflow-x-auto text-sm md:order-none md:mx-0 md:mr-auto md:ml-6 md:w-auto md:overflow-visible">
              {([['work', 'My work'], ['processes', 'Processes'], ['board', 'Delivery board']] as const).filter(([page]) => page === 'work' || parts[page]).map(([page, label]) => {
                const here = nav.route.page === page || (page === 'processes' && nav.route.page === 'process');
                return (
                  <a key={page} href={`${base}/${page}`} aria-label={label} aria-current={here ? 'page' : undefined} onClick={e => { e.preventDefault(); nav.go({ page }); }} className={navItem(here)}>
                    <svg viewBox="0 0 20 20" className={`h-[18px] w-[18px] shrink-0 ${here ? 'text-[#002C4B]' : 'text-slate-400 group-hover:text-slate-600'}`} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{NAV_ICON[page]}</svg>
                    <span className="whitespace-nowrap">{page === 'board' ? <><span className="hidden sm:inline">Delivery </span><span className="inline-block first-letter:uppercase sm:first-letter:normal-case">board</span></> : label}</span>
                  </a>
                );
              })}
            </nav>
          )}
          {signedIn && (
            <div className="flex items-center gap-2 self-stretch">
              {/* Ask Avala on every page, about where the person is (keyed so a new workspace starts it afresh). */}
              {ws && <React.Fragment key={ws.current.id}><AskAvala store={store} nav={nav} workspace={ws.current} /></React.Fragment>}
              {ws && <WorkspaceSwitcher store={store} ws={ws} />}
              {ws && (
                <a href={`${base}/settings`} aria-label="Settings" aria-current={nav.route.page === 'settings' ? 'page' : undefined} onClick={e => { e.preventDefault(); nav.go({ page: 'settings', section: 'people' }); }}
                  className={`self-stretch ${navItem(nav.route.page === 'settings')}`}>
                  <svg viewBox="0 0 20 20" className={`h-[18px] w-[18px] shrink-0 ${nav.route.page === 'settings' ? 'text-[#002C4B]' : 'text-slate-400 group-hover:text-slate-600'}`} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 5.5h7.2M14.8 5.5H17M3 10h2.2M8.8 10H17M3 14.5h8.2M15.8 14.5H17" />
                    <circle cx="12.5" cy="5.5" r="1.9" /><circle cx="6.5" cy="10" r="1.9" /><circle cx="13.5" cy="14.5" r="1.9" />
                  </svg>
                  <span className="hidden lg:inline">Settings</span>
                </a>
              )}
              {!demo && me && <AccountMenu store={store} me={me} />}
            </div>
          )}
          {demo && <a href="/" className="hidden rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:block">Leave the demo</a>}
        </div>
      </header>
      {demo && (
        <div data-testid="demo-banner" role="note" className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-center text-sm text-amber-950">
          Demo on a sample case: Kaveri Industrial Components is a made-up company. Try anything; nothing is saved, and reloading starts again.
          {/* On a phone the top bar has no room for it. */}
          <a href="/" className="ml-1 font-semibold underline sm:hidden">Leave the demo</a>
        </div>
      )}
      {store.kind === 'memory' && (
        <div data-testid="local-mode" className="border-b border-amber-200 bg-amber-50 px-6 py-1.5 text-center text-xs text-amber-900">
          Local mode: data stays in this browser and is not saved to a server.
        </div>
      )}
      <main className={`mx-auto px-6 py-8 ${wide ? 'max-w-[120rem]' : 'max-w-7xl'}`}>
        {!me || nav.route.page === 'signin' ? <SignInPage store={store} initialError={signInRedirectError} /> :
          nav.route.page === 'reset-password' ? <ResetPasswordPage store={store} nav={nav} /> :
          !list ? (listError ? <ErrorNote message={listError} /> : <Spinner />) :
          !ws ? <FirstRun store={store} onCreated={reload} /> :
          nav.route.page === 'work' ? <React.Fragment key={ws.current.id}><MyWorkPage store={store} nav={nav} workspace={ws.current} userId={me.id} /></React.Fragment> :
          nav.route.page === 'processes' ? <React.Fragment key={ws.current.id}><ProcessesPage store={store} nav={nav} workspace={ws.current} /></React.Fragment> :
          nav.route.page === 'settings' ? <React.Fragment key={ws.current.id}><SettingsPage store={store} nav={nav} workspace={ws.current} section={nav.route.section} base={base} /></React.Fragment> :
          nav.route.page === 'board' ? <React.Fragment key={ws.current.id}><BoardPage store={store} nav={nav} ws={ws} projectId={nav.route.projectId} itemId={nav.route.itemId} /></React.Fragment> :
            <React.Fragment key={nav.route.processId}><ProcessWorkspace store={store} nav={nav} processId={nav.route.processId} stage={nav.route.stage} onWorkspace={ws.show} /></React.Fragment>}
      </main>
    </div>
  );
}
