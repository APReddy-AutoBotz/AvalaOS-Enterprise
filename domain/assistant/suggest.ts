// Ask Avala's suggestions (docs/product-plan.md, "Ask Avala: the plan", stage 3: proposals a person
// confirms). Ask Avala may suggest a change; the person reviews it on the screen that already exists for
// that kind of change and confirms it there. Nothing is applied from the panel. Each suggestion says what,
// why (the facts or the passage behind it) and what it would do, and is offered only to a person whose
// role may make that change (`can`).
//
// Kinds, in the plan's order:
//   - answer: an open question a source already answers. The sources' passages most likely to answer
//     the open questions go to the existing `answerFromNotes` task with the questions; only values a
//     passage states outright are suggested (never "inferred"), one per question, with the passage.
//   - work-item: a requirement the work-item proposals do not plan yet, with why (`planWork`, `coverage`).
//   - application: facts the workspace's applications list holds about an application this process
//     uses and the process does not (`applicationOffer`).
// Drafts of document sections come next, in the same shape.
import type { ProcessModel } from '../processModel/types.ts';
import type { Segment } from '../ai/gateway.ts';
import type { StageId } from '../workspace/route.ts';
import { can, type Action, type MemberFacts } from '../people/roles.ts';
import { notesSegments, proposalsFrom, type NoteFinding, type Proposal } from '../questions/notes.ts';
import type { TriageItem } from '../questions/triage.ts';
import type { NotPlanned } from '../workitems/derive.ts';
import { applicationOffer, matchApplication, type Application } from '../workspace/applications.ts';
import { relevantPassages, type Passage } from './ask.ts';

export const SUGGEST_LIMITS = { perQuestion: 4, passages: 40, passageChars: 1200 } as const;

export type SuggestionTarget =
  /** Opens the interview on that question with the answer filled in, to Save or change. */
  | { kind: 'answer'; itemKey: string; proposal: Proposal; source: string }
  /** Opens the stage where that change is made. */
  | { kind: 'stage'; stage: StageId };

export interface Suggestion {
  /** Stable while the suggestion holds, so a dismissal is remembered. */
  key: string;
  kind: 'answer' | 'work-item' | 'application';
  title: string;
  why: string;
  /** The words it rests on, and where they are, for an answer from a source. */
  quote?: { text: string; source: string };
  /** What applying it would do, in words. */
  willDo: string;
  /** The permission it needs. */
  needs: Action;
  target: SuggestionTarget;
}

/** For each open question the few passages sharing the most words with it, at most `passages` in all, in their order. */
export function passagesFor(items: TriageItem[], passages: Passage[]): Passage[] {
  const picked = new Set<Passage>();
  for (const it of items) for (const p of relevantPassages(it.question, passages, SUGGEST_LIMITS.perQuestion)) picked.add(p);
  return passages.filter(p => picked.has(p)).slice(0, SUGGEST_LIMITS.passages);
}

const where = (p: Passage) => {
  const l = p.locator as Record<string, unknown>;
  const at = [l.section ?? l.heading, l.timestamp, l.page !== undefined ? `page ${l.page}` : undefined].filter(Boolean).join(', ');
  return at ? `${p.sourceTitle}, ${at}` : p.sourceTitle;
};

/** The questions (as for notes) and the chosen passages, each passage an "n:" segment with its source. */
export function sourceSegments(model: ProcessModel, items: TriageItem[], passages: Passage[]): { segments: Segment[]; ids: Map<string, string>; passageOf: Map<string, Passage> } {
  const { segments, ids } = notesSegments(model, items, '');
  const passageOf = new Map<string, Passage>();
  const notes = passagesFor(items, passages).map((p, i) => {
    passageOf.set(`n:${i + 1}`, p);
    return { id: `n:${i + 1}`, text: p.text.slice(0, SUGGEST_LIMITS.passageChars), sourceId: p.sourceKey, locator: where(p) };
  });
  return { segments: [...segments.filter(s => s.id.startsWith('q:')), ...notes], ids, passageOf };
}

/** Answers the sources state outright, one per question, with the passage; never an inferred one. */
export function answerSuggestions(model: ProcessModel, items: TriageItem[], ids: Map<string, string>, findings: NoteFinding[], passageOf: Map<string, Passage>): Suggestion[] {
  const stated = findings.filter(f => f.certainty === 'stated' && passageOf.has(f.segmentId));
  return proposalsFrom(model, items, ids, stated).map(p => {
    const f = stated.find(x => ids.get(x.questionId.replace(/^q:/, '')) === p.itemKey)!;
    const source = where(passageOf.get(f.segmentId)!);
    return {
      key: `answer:${p.itemKey}:${p.display}`, kind: 'answer', title: `A source answers: ${p.question}`,
      why: `The sources already say it, so the question need not be asked.`,
      quote: { text: p.quote, source }, willDo: `Record: ${p.display}`, needs: 'edit_process',
      target: { kind: 'answer', itemKey: p.itemKey, proposal: p, source },
    };
  });
}

/** Requirements no work-item proposal plans yet, with why. */
export function workItemSuggestions(notPlanned: NotPlanned[]): Suggestion[] {
  return notPlanned.map(n => ({
    key: `work-item:${n.code}`, kind: 'work-item', title: `${n.code} ${n.title} has no work item yet`,
    why: n.reason, willDo: 'Plan a work item for it on the Work items stage.', needs: 'work_items', target: { kind: 'stage', stage: 'work-items' },
  }));
}

/** Facts the applications list holds about an application this process uses and the process does not. */
export function applicationSuggestions(model: ProcessModel, apps: Application[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const s of model.systems) {
    const app = matchApplication(s, apps);
    const lines = app ? applicationOffer(s, app) : [];
    if (!app || !lines.length) continue;
    out.push({
      key: `application:${s.id}:${lines.join('|')}`, kind: 'application',
      title: `${lines.length} ${lines.length === 1 ? 'fact' : 'facts'} about ${s.name} to bring in from the applications list`,
      why: lines.join('; '), willDo: 'Review them under Roles and systems on the Process stage, and accept them there.', needs: 'edit_process',
      target: { kind: 'stage', stage: 'process' },
    });
  }
  return out;
}

/** Only what this person may do, not dismissed, in the plan's order. */
export function suggestionsFor(all: Suggestion[], member: MemberFacts, dismissed: readonly string[] = []): Suggestion[] {
  const order = { answer: 0, 'work-item': 1, application: 2 } as const;
  return all.filter(s => can(member, s.needs) && !dismissed.includes(s.key)).sort((a, b) => order[a.kind] - order[b.kind]);
}

/** The history line when a person confirms an answer a source gave: who suggested it and from where. */
export const suggestedSummary = (question: string, source: string) => `Suggested by Ask Avala from ${source}; confirmed: ${question}`;
