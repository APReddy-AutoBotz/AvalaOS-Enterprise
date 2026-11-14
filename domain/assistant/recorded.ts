// Recorded answers for the demo (docs/product-plan.md, "Ask Avala: the plan", stage 1: "Three recorded
// answers per scope on the sample case"). The demo has no AI, so the starter questions of each scope were
// asked once against the live server on the sample case and their replies kept as the gateway returned
// them (public/demo-data/ask-answers.json, made by `node eval/ask/run.ts --record`). The panel reads a
// recorded reply exactly as a live one, with the facts it builds from the demo's own data, so a citation
// that no longer matches a fact is dropped, never shown; a test keeps every one resolving.
export const RECORDED_LABEL = 'Recorded answer on the sample case';

export interface RecordedAnswer {
  /** The task it was asked with: askProcess, askBoard or askWorkspace. */
  task: string;
  question: string;
  /** The gateway's reply: sentences with segmentId, excerpt, role and group, and missing. */
  reply: unknown;
}

const key = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** The recorded reply for this task and question, if there is one. */
export function findRecorded(all: readonly RecordedAnswer[], task: string, question: string): RecordedAnswer | null {
  return all.find(r => r.task === task && key(r.question) === key(question)) ?? null;
}

/** What the demo says to a question it has no recorded answer for. */
export const NOT_RECORDED = 'The demo has recorded answers only for the suggested questions. Other questions need the server: sign in to ask them.';
