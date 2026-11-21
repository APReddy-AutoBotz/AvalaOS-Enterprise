// The demo at /demo: the product itself on the sample case (eval/corpus/ap-invoice, a made-up company), in
// the browser only. It starts from the state the tour test leaves the sample in (public/demo-data/sample.json,
// refreshed from that test), keeps every change in memory, and never talks to the database or the AI. It opens
// on the sample's assessment, with one line saying what to look at next.
//
// A teardown (domain/site/teardowns.ts) runs the same way at /demo/teardowns/<slug>, from its own file
// (public/demo-data/teardowns/<slug>.json), with its source and licence lines on every page.
import React from 'react';
import { Journey } from '../JourneyApp.tsx';
import { createMemoryStore } from '../store/memoryStore.ts';
import type { JourneyStore } from '../store/types.ts';
import { DEMO_BASE } from '../../domain/site/pages.ts';
import { DEMO_START_STAGE } from '../../domain/site/demo.ts';
import { TEARDOWN_INDEX_URL, teardownBase, teardownDataUrl, teardownSlug, type TeardownLink, type TeardownWords } from '../../domain/site/teardowns.ts';
import { firstListCounts } from '../../domain/questions/counts.ts';
import type { JourneyRoute } from '../../domain/workspace/route.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { TeardownContext, TeardownListContext, type TeardownView } from '../teardown.tsx';
import { Spinner } from '../ui.tsx';

export const DEMO_DATA = '/demo-data/sample.json';
/** Ask Avala's recorded answers to the suggested questions on the sample case (domain/assistant/recorded.ts). */
export const DEMO_ANSWERS = '/demo-data/ask-answers.json';

export default function DemoApp() {
  const slug = React.useMemo(() => teardownSlug(location.pathname), []);
  const [store, setStore] = React.useState<JourneyStore | null>(null);
  // The demo opens on the sample's assessment (marketing review, 18 November 2026), a teardown on its own.
  const [start, setStart] = React.useState<JourneyRoute | undefined>(undefined);
  const [teardown, setTeardown] = React.useState<TeardownView | null>(null);
  const [list, setList] = React.useState<TeardownLink[]>([]);
  const [failed, setFailed] = React.useState<'failed' | 'missing' | null>(null);

  React.useEffect(() => {
    document.title = 'Demo | Avala OS';
    let live = true;
    fetch(TEARDOWN_INDEX_URL).then(r => (r.ok ? r.json() : [])).then(l => { if (live && Array.isArray(l)) setList(l); }).catch(() => undefined);
    // The recorded answers are a nicety: without them the demo still runs, and Ask Avala says it needs the server.
    // They are the sample's, so a teardown has none.
    const answers = slug ? Promise.resolve([]) : fetch(DEMO_ANSWERS).then(r => (r.ok ? r.json() : [])).then(a => (Array.isArray(a) ? a : [])).catch(() => []);
    fetch(slug ? teardownDataUrl(slug) : DEMO_DATA)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'missing' : `HTTP ${r.status}`))))
      .then(async data => {
        const recorded = await answers;
        if (!live) return;
        const first = Array.isArray(data?.processes) ? data.processes[0] : null;
        if (first?.id) setStart({ page: 'process', processId: String(first.id), stage: DEMO_START_STAGE });
        if (slug) {
          const words = data?.teardown as TeardownWords | undefined;
          if (!words) throw new Error('missing');
          const model = data?.revisions?.[0]?.model as ProcessModel | undefined;
          const c = firstListCounts(model);
          setTeardown({ words, openQuestions: c ? c.now + c.found + c.wait : 0 });
          document.title = `${words.short} · Demo | Avala OS`;
        }
        setStore(createMemoryStore({ demo: data, recorded: recorded.length ? recorded : undefined }));
      })
      .catch((e: Error) => { if (live) setFailed(e?.message === 'missing' ? 'missing' : 'failed'); });
    return () => { live = false; };
  }, [slug]);

  if (failed) {
    return (
      <main className="mx-auto max-w-lg p-10 text-center">
        <h1 className="font-display text-xl font-semibold text-slate-900">{failed === 'missing' ? 'This teardown is not in the demo' : 'The demo did not load'}</h1>
        <p className="mt-2 text-sm text-slate-600">{failed === 'missing' ? <>Open <a href={DEMO_BASE} className="font-semibold text-[#002C4B] underline">the demo</a> to see the sample case.</> : <>Reload the page to try again, or <a href="/" className="font-semibold text-[#002C4B] underline">go back to the homepage</a>.</>}</p>
      </main>
    );
  }
  if (!store) return <Spinner />;
  return (
    <TeardownListContext.Provider value={list}>
      <TeardownContext.Provider value={teardown}>
        <Journey store={store} base={slug ? teardownBase(slug) : DEMO_BASE} start={start} />
      </TeardownContext.Provider>
    </TeardownListContext.Provider>
  );
}
