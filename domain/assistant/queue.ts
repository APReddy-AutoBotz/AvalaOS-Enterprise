// A question put to Ask Avala before the panel can answer it (the record is still being read, or the
// answer before it is still coming) is kept and asked, in order, as soon as the panel is ready. It is
// never dropped without a word (docs/next-plan.md, package 3).
export interface AskState { ready: boolean; busy: boolean; waiting: string[] }
export interface AskStep { ask: string | null; waiting: string[] }

/** A question submitted now: asked at once when the panel is free and nothing waits before it, else kept. */
export function submitQuestion(s: AskState, question: string): AskStep {
  return s.ready && !s.busy && !s.waiting.length ? { ask: question, waiting: [] } : { ask: null, waiting: [...s.waiting, question] };
}

/** The next kept question to ask, once the panel is ready and free. */
export function nextQuestion(s: AskState): AskStep {
  return s.ready && !s.busy && s.waiting.length ? { ask: s.waiting[0], waiting: s.waiting.slice(1) } : { ask: null, waiting: s.waiting };
}

/** What a kept question says while it waits. */
export const waitingNote = (s: { ready: boolean; failed: boolean }): string =>
  s.failed ? 'Not asked: the record could not be read. Close the panel and open it again to try once more.'
    : !s.ready ? 'Kept: Ask Avala is still reading the record, and asks this as soon as it is ready.'
    : 'Kept: asked next, once the answer above is ready.';
