// The teardown a demo page shows, if any (domain/site/teardowns.ts): DemoApp provides it, and the few places
// that differ on a teardown read it here (the banner, Ask Avala's line, the downloads not offered, the BPMN
// download's lines, the printed assessment). Outside a teardown it is null and nothing changes.
import React from 'react';
import { openQuestionsLine, removedLine, type TeardownLink, type TeardownWords } from '../domain/site/teardowns.ts';

export interface TeardownView { words: TeardownWords; openQuestions: number }
export const TeardownContext = React.createContext<TeardownView | null>(null);
export const useTeardown = () => React.useContext(TeardownContext);
/** The teardowns the demo holds, for the banner's links (sample and teardowns alike). */
export const TeardownListContext = React.createContext<TeardownLink[]>([]);
export const useTeardownList = () => React.useContext(TeardownListContext);

/** The lines every teardown page carries, above the journey and at the top of a printed assessment. */
export function TeardownLines({ view, compact = false }: { view: TeardownView; compact?: boolean }) {
  const w = view.words;
  const removed = removedLine(w);
  return (
    <div data-testid="teardown-lines" className={compact ? 'space-y-1 text-xs text-slate-700' : 'space-y-1'}>
      <p className="font-semibold" data-testid="teardown-label">{w.label}</p>
      <p data-testid="teardown-credit"><a href={w.credit.url} className="underline" rel="noopener noreferrer" target="_blank">{w.credit.text}</a></p>
      <p data-testid="teardown-source"><a href={w.source.url} className="underline" rel="noopener noreferrer" target="_blank">{w.source.text}</a> Retrieved {w.source.retrieved}.</p>
      <p data-testid="teardown-not-review">{w.notReview}</p>
      <p data-testid="teardown-open">{openQuestionsLine(view.openQuestions)}</p>
      {removed && <p data-testid="teardown-removed">{removed}</p>}
    </div>
  );
}
