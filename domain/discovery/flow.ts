// The Discovery tab's rules (package B, pull request 4b, plan `claude/package-b-pr4-plan-24-nov.md`, section 4;
// approved 24 November 2026): who sees the tab, where a session stands, and what each answer on a card writes.
// The screen (journey/process/DiscoveryPanel.tsx) holds no rule of its own. Every write goes through the existing
// operations (domain/processModel/patch.ts), a person's Save only; a value a person confirmed is never overwritten.
import type { AccessStatus, ElementTarget, ProcessModel } from '../processModel/types.ts';
import { addQuestion, closeQuestions, deferQuestion, resolveConflict, setBriefFact, setPurpose } from '../processModel/patch.ts';
import { orderedSteps } from '../processModel/selectors.ts';
import { buildAnswer, record, type Op } from '../questions/answer.ts';
import { OWNER_LABEL, type Triage, type TriageItem } from '../questions/triage.ts';
import { ANSWER_TO, answersKey, answerAgainstConfirmed, type AnswerOutcome } from './answers.ts';
import type { Card } from './card.ts';
import type { Proposal } from '../questions/notes.ts';
import { interviewEdit } from '../questions/interview.ts';
import { conflictValue } from '../questions/conflictValue.ts';

// ---- Who sees the tab -----------------------------------------------------------------------------

export type DiscoveryTab =
  /** A fourth tab beside Ask, Questions and Suggestions. */
  | 'tab'
  /** The only tab: the process has no steps yet. */
  | 'only'
  /** No tab; on a process with no steps, one line says who can start it. */
  | 'viewer'
  /** The demo: one paragraph, nothing to press. */
  | 'demo'
  /** Nothing: the workspace has no AI here. */
  | 'none';

/** People who can edit the process run a session, where the workspace has AI (plan, decision 3). */
export function discoveryTab(a: { canEdit: boolean; aiAvailable: boolean; demo: boolean; hasSteps: boolean }): DiscoveryTab {
  if (a.demo) return 'demo';
  if (!a.aiAvailable) return 'none';
  if (!a.canEdit) return 'viewer';
  return a.hasSteps ? 'tab' : 'only';
}

export const WORDS = {
  intro: 'Describe how the work goes today, or how it should go, in your own words. Ask Avala reads it, shows you the steps it understood, then asks one question at a time about what you said. Nothing joins the process until you press Save.',
  kept: 'Your words are kept as a source, so everything read from them can quote them.',
  reading: 'Reading what you said. This takes a minute or two; you can close this panel and come back.',
  updating: 'Updating the draft from your answers. This takes two or three minutes. Nothing changes until you review what it found.',
  shapeWaits: 'Your answer is kept with this session. It does not change the draft yet: the steps change only when you press Update the draft from your answers.',
  nothing: 'Nothing is recorded until you press Save.',
  viewer: 'Someone who can edit this process can start Discovery.',
  otherTabs: 'Ask, Questions and Suggestions open once the process has steps.',
  demo: 'Discovery asks about a process in conversation. It reads what people say, so it needs the AI, which the demo does not call. In a workspace, start a process with "Add and start with Ask Avala".',
  decided: 'An approach already decided is set in The brief, with who decided it and why.',
  allowance: (month: string) => `This workspace has used its AI allowance for the month, so Ask Avala cannot read words until it starts again on 1 ${month}. Questions with a choice or a number still save.`,
} as const;

/** Under a card whose words were kept to read later: when they were kept. */
export const laterLine = (at: string) => `Your words, kept on ${new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })} to read later. Read them when you like, or clear them.`;

/** "Kept. The draft is unchanged until you update it (3 answers waiting)." */
export const keptLine = (k: number) => `Kept. The draft is unchanged until you update it (${k} ${k === 1 ? 'answer' : 'answers'} waiting).`;

/** The update button's words. */
export const updateLabel = (k: number) => `Update the draft from your answers (${k})`;

/** Before an update that reads uploaded files again. */
export const updateNote = (sources: number, files: number) =>
  files > 0 ? `This reads ${sources} sources again, your answers and ${files} ${files === 1 ? 'file' : 'files'}, and takes about three minutes.` : '';

// ---- Where a session stands ---------------------------------------------------------------------

export type Stage =
  /** No description yet: the description and the first cards. */
  | 'describe'
  /** A reading is running. */
  | 'reading'
  /** The first reading is done and not brought in yet: "What I understand so far". */
  | 'first'
  /** The process has steps: one card at a time. */
  | 'cards';

export function stageOf(a: { hasSteps: boolean; sources: number; run: { status: string; model: unknown } | null }): Stage {
  const running = a.run && a.run.status !== 'done' && a.run.status !== 'failed';
  if (running) return 'reading';
  if (a.hasSteps) return 'cards';
  if (a.run?.status === 'done' && a.run.model) return 'first';
  return a.sources ? 'first' : 'describe';
}

/** The steps the reading understood, in order, each with who, where, and the words it came from. */
export function stepsWithWords(m: ProcessModel): { name: string; role: string | null; app: string | null; words: string | null }[] {
  const name = (list: { id: string; name: string }[], ids: string[]) => ids.map(id => list.find(x => x.id === id)?.name).filter(Boolean).join(', ') || null;
  return orderedSteps(m).map(s => ({ name: s.name, role: name(m.roles, s.roleIds), app: name(m.systems, s.systemIds), words: s.sources[0]?.excerpt?.trim() || null }));
}

/** The sources an update of the draft reads: those the last reading read, then the new answers source. */
export function updateSources(lastRead: readonly string[], active: readonly { id: string }[], answersId: string): string[] {
  const live = new Set(active.map(s => s.id));
  const base = lastRead.filter(id => live.has(id) && id !== answersId);
  return [...(base.length ? base : active.map(s => s.id).filter(id => id !== answersId)), answersId];
}

// ---- What an answer on a card writes --------------------------------------------------------------

/** The triage item a card stands for, when it stands for one. */
export const cardItem = (card: Card, t: Triage): TriageItem | undefined => (card.itemKey ? t.items.find(i => i.key === card.itemKey) : undefined);

export interface Edit { op: Op; summary: string; line?: string }

/** A choice on a card. Null when nothing is written (an approach already decided is set in The brief; "Not sure yet"). */
export function chooseEdit(card: Card, m: ProcessModel, pick: string, ctx: {
  /** The signed-in person's id, and their name as the other screens store a chooser's (`chosenBy`): who chose is kept. */
  me: string | null; name: string; at: string; item?: TriageItem; statuses?: Record<number, AccessStatus>;
}): Edit | null {
  if (card.key === 'start:purpose') {
    if (pick !== 'assess' && pick !== 'as_is') return null;
    return { op: x => setPurpose(x, { value: pick, by: ctx.me, at: ctx.at }), summary: 'What is wanted from the process, from Discovery' };
  }
  if (card.key === 'start:doneToday') {
    if (pick !== 'yes' && pick !== 'partly' && pick !== 'no') return null;
    return { op: x => setBriefFact(x, { fact: 'doneToday', value: pick }), summary: 'Whether the work is done today, from Discovery' };
  }
  if (card.origin.kind === 'conflict') {
    const c = m.conflicts.find(x => x.id === (card.origin as { conflictId: string }).conflictId);
    if (!c || !c.values.some(v => v.value === pick)) return null;
    return { op: x => resolveConflict(x, { conflictId: c.id, chosen: pick, by: ctx.name.trim() || 'Not recorded', ...(ctx.me ? { byId: ctx.me } : {}), reason: 'Chosen in a discovery session.', ...conflictValue(x, c, pick) }), summary: `Conflict resolved: ${c.summary}` };
  }
  if (ctx.item) {
    const built = buildAnswer(ctx.item, m, { pick, statuses: ctx.statuses });
    return built && { op: built.op, summary: built.summary };
  }
  return null;
}

/**
 * An answer read from a person's words, through the existing interview's edit. When it differs from a value a
 * person confirmed it never overwrites it: the card says so before Save, and Save records the difference
 * (answerAgainstConfirmed). `answersKey` names the source the words will be kept in for that case.
 */
export function wordsEdit(m: ProcessModel, item: TriageItem, p: Proposal, keys: readonly string[]): (Edit & { outcome: AnswerOutcome['kind']; keepWords?: { key: string; question: string; words: string } }) | null {
  const edit = interviewEdit(m, item, p);
  if (!edit) return null;
  const key = answersKey(keys);
  const quote = { sourceId: key, excerpt: p.quote.replace(/\s+/g, ' ').trim(), locator: { heading: `${ANSWER_TO}${item.question}`, lineStart: 1 } };
  const out = answerAgainstConfirmed(m, { target: item.target, label: item.question, said: { value: p.display, quote }, write: edit.op });
  if (out.kind === 'write') return { op: edit.op, summary: edit.summary, outcome: 'write' };
  return { op: out.op, summary: `Answer differs from a confirmed value: ${item.question}`, line: confirmedLine(m, item.target) ?? out.line ?? undefined, outcome: out.kind, keepWords: { key, question: item.question, words: p.quote } };
}

/**
 * A step or an application is confirmed by a person as a whole, not field by field (review, 23 November 2026):
 * an answer about any field of a confirmed element is held back, and the card says so in plain words.
 */
export function confirmedLine(m: ProcessModel, t: ElementTarget): string | null {
  const el = t.kind === 'step' ? m.steps.find(x => x.id === t.id) : t.kind === 'system' ? m.systems.find(x => x.id === t.id) : t.kind === 'role' ? m.roles.find(x => x.id === t.id) : null;
  if (!el || el.status !== 'user-confirmed') return null;
  const what = t.kind === 'step' ? `The step "${el.name}"` : t.kind === 'system' ? `The application ${el.name}` : `The role ${el.name}`;
  return `${what} was confirmed by a person, so this answer does not change it. Saving keeps what was confirmed and records the difference to settle on the Process stage.`;
}

const asked = (card: Card) => ({ target: card.target, question: card.question });

/** "Not known, ask someone": the question is left with the named person, and goes into the question file for their kind. */
export function leaveWith(card: Card, item: TriageItem | undefined, name: string): Edit | null {
  const who = name.trim().slice(0, 120);
  if (!who) return null;
  const file = OWNER_LABEL[item?.owner ?? 'business'];
  return {
    op: x => deferQuestion(x, { questionIds: item?.questionIds ?? [], owner: who, gap: asked(card) }),
    summary: `Set aside for ${who}: ${card.question}`,
    line: `Left with ${who}. It is in the question file for the ${/^[A-Z][a-z]/.test(file) ? file.charAt(0).toLowerCase() + file.slice(1) : file}.`,
  };
}

export const NOT_APPLICABLE = 'Not applicable to this process.';

/** "Not applicable": the question is closed with that answer; a card with no stored question records it first. */
export function notApplicable(card: Card, item: TriageItem | undefined): Edit {
  if (item) return { op: record(item, NOT_APPLICABLE), summary: `Not applicable: ${card.question}` };
  return {
    op: x => {
      const a = addQuestion(x, { target: card.target, question: card.question, whyItMatters: card.why || 'Asked in a discovery session.' });
      const b = closeQuestions(a.model, { questionIds: [a.questionId], answer: NOT_APPLICABLE });
      return { model: b.model, patch: [...a.patch, ...b.patch] };
    },
    summary: `Not applicable: ${card.question}`,
  };
}
