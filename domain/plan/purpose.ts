// What a person wants from a process (docs/next-plan.md, section 3c), and everything that follows from
// it, in one place. A page, a count, a document, the weekday email and Ask Avala all ask this file what
// a process shows; none decides for itself. Avala OS never works the answer out from the sources: with
// no answer, a process is assessed and documented, as every process was before this existed.
//
// The answer is kept on the record as `meta.purpose`, beside the brief and not inside it: the released
// site checks every line of the brief and refuses one it does not know, but ignores a new entry of the
// record's `meta`. Switching the answer changes only that entry; nothing else is removed or rewritten.
import type { ElementTarget, ProcessModel, ProcessPurpose } from '../processModel/types.ts';
import type { DocType } from '../docs/tree.ts';
import { STAGES, type StageId } from '../workspace/route.ts';
import { stagesFor } from '../workspace/modules.ts';

export const PURPOSES = ['assess', 'as_is'] as const;
export type PurposeValue = (typeof PURPOSES)[number];

export type { ProcessPurpose };

export const PURPOSE_LABEL: Record<PurposeValue, string> = {
  assess: 'Assess it and document it',
  as_is: 'Document it as it is',
};
export const PURPOSE_WHAT: Record<PurposeValue, string> = {
  assess: 'Avala OS assesses how each step could be done and writes the documents for the change: BRD, PDD, FRD, SDD and the rest.',
  as_is: 'No change is being made: the process document, its map and the evidence pack describe how the work is done, and nothing is assessed.',
};
/** The line a list of processes shows instead of a score, when there is one. */
export const NOT_ASSESSED = 'Documented as it is, not assessed';

/** The answer in effect: "assess" when nobody has answered. */
export function purposeOf(m: ProcessModel | null | undefined): PurposeValue {
  const v = m?.meta.purpose?.value;
  return v && (PURPOSES as readonly string[]).includes(v) ? v : 'assess';
}

/** What follows from the answer. */
export interface WhatFollows {
  purpose: PurposeValue;
  /** The process has an assessment: a score, a recommendation, a place in a ranking. */
  assessed: boolean;
  /** The stages of a process this answer leaves out (a part the organisation does not use is left out by `stagesFor`). */
  hiddenStages: StageId[];
  /** The documents offered, in their order; null: every document, as today. */
  documents: DocType[] | null;
  /** A To-Be map and anything about how the process will be done in future. */
  future: boolean;
  /** The brief's line "What the team has in mind" (an expectation about automation). */
  asksInMind: boolean;
  /** Work proposals: the Work items stage, "proposals waiting", suggestions of work to plan. */
  plansWork: boolean;
}

export const whatFollows = (m: ProcessModel | null | undefined): WhatFollows => followsFrom(purposeOf(m));

/** What follows from an answer, for a place that holds the answer and not the record (a list of processes). */
export function followsFrom(purpose: PurposeValue = 'assess'): WhatFollows {
  if (purpose === 'as_is') {
    return { purpose, assessed: false, hiddenStages: ['assessment', 'work-items'], documents: ['pdd', 'evidence'], future: false, asksInMind: false, plansWork: false };
  }
  return { purpose, assessed: true, hiddenStages: [], documents: null, future: true, asksInMind: true, plansWork: true };
}

/** The stages of one process: those of the organisation's parts, less those its answer leaves out. */
export function stagesForProcess(modules: readonly string[] | undefined, m: ProcessModel | null | undefined): StageId[] {
  // Without the documents there is nothing to document a process as it is with: every process is assessed.
  if (!offersPurpose(modules)) return stagesFor(modules);
  const hidden = new Set(whatFollows(m).hiddenStages);
  return stagesFor(modules).filter(s => !hidden.has(s));
}

/** Whether a document is offered for this process. */
export function offersDocument(m: ProcessModel | null | undefined, type: DocType): boolean {
  const d = whatFollows(m).documents;
  return d === null || d.includes(type);
}

/**
 * The question whether to ask it at all: only an organisation that uses the documents has a use for
 * "Document it as it is". Without them, every process is assessed and nothing is asked.
 */
export const offersPurpose = (modules: readonly string[] | undefined) => stagesFor(modules).includes('documents');

const stageLabel = (s: StageId) => STAGES.find(x => x.id === s)?.label ?? s;

/** One line on a stage this answer leaves out, saying why and where to change it. Null when the stage is shown. */
export function purposeOffMessage(stage: StageId, m: ProcessModel | null | undefined): string | null {
  const w = whatFollows(m);
  if (!w.hiddenStages.includes(stage)) return null;
  return `${stageLabel(stage)} is not part of this process: it is documented as it is, with no assessment. To change that, answer "What do you want from this process?" in The brief, on the Process page.`;
}

/** The line on Documents about the documents not offered, or null when every document is. */
export function documentsNote(m: ProcessModel | null | undefined): string | null {
  if (whatFollows(m).documents === null) return null;
  return 'This process is documented as it is, so its documents are the process document and the evidence pack. The BRD, FRD, SDD, agent document and test pack each describe a change; to have them, answer "What do you want from this process?" in The brief, on the Process page.';
}

// ---- Questions

/** Figures that only size a saving: not asked when nothing is being changed. */
const SAVING_FIGURES = new Set(['volume', 'handling_time', 'exception_rate', 'fte']);
const FIGURE_WORDS = /\b(handling[- ]times?|time per (?:case|item|invoice|request)|how long does|volumes?|(?:cases|items|invoices|requests) (?:per|a|each) (?:day|week|month|year)|exception rate|share of exceptions|how many (?:people|ftes?)|full[- ]time)\b/i;

/**
 * Whether a question is asked for this process. Kept for every answer: who does a step, which
 * application it uses, the objective and the owner, who handles an exception, the decision points and
 * any question in free words. Not asked when the process is documented as it is: how an application
 * can be reached by an automation, and the figures that size a saving (by their kind, or a question in
 * free words about one). Nothing is closed: a question not asked stays on the record as it was.
 */
export function asksQuestion(m: ProcessModel, q: { target: ElementTarget; question: string }): boolean {
  if (purposeOf(m) !== 'as_is') return true;
  const t = q.target;
  if (t.kind === 'system' && t.field === 'access') return false;
  if (t.kind === 'metric') {
    const kind = t.id ? m.meta.metrics.find(x => x.id === t.id)?.kind : t.field;
    if (kind && SAVING_FIGURES.has(kind)) return false;
  }
  if (t.kind === 'meta' && !t.field && FIGURE_WORDS.test(q.question)) return false;
  return true;
}

/** Whether a figure of the process is one that only sizes a saving (kept in the document when recorded, never asked for). */
export const savingFigure = (kind: string) => SAVING_FIGURES.has(kind);
